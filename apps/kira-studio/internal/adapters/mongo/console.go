package mongo

import (
	"context"
	"errors"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"
	mongodriver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// §8.14: "for non-SQL engines the console takes that engine's native command form" — Mongo's shell
// syntax db.<collection>.<method>(<args>). literal.go's parser handles the argument list; this
// file owns the statement grammar and the per-method dispatch.

type parsedStatement struct {
	collection string
	method     string
	args       []any
}

var supportedConsoleMethods = func() map[string]bool {
	m := make(map[string]bool, len(model.MongoConsoleMethods))
	for _, name := range model.MongoConsoleMethods {
		m[name] = true
	}
	return m
}()

// writeConsoleMethods is the read-only guard's classification of MongoConsoleMethods — insertOne
// through deleteMany are unconditionally writes; find/findOne/countDocuments are unconditionally
// reads. aggregate is neither by default (isAggregateWrite below decides it per statement) since a
// pipeline can carry a $out/$merge stage that writes despite the method name.
var writeConsoleMethods = map[string]bool{
	"insertOne":  true,
	"insertMany": true,
	"updateOne":  true,
	"updateMany": true,
	"deleteOne":  true,
	"deleteMany": true,
}

// isAggregateWrite reports whether an aggregate() pipeline's first argument contains a $out or
// $merge stage — the two aggregation stages that write to a collection despite arriving through
// find-shaped syntax. A pipeline that fails to parse as the expected bson.A/bson.D shape is not
// flagged here; runStatement's own asDocArray call reports that error normally.
func isAggregateWrite(stmt parsedStatement) bool {
	if len(stmt.args) == 0 || stmt.args[0] == nil {
		return false
	}
	pipeline, ok := stmt.args[0].(bson.A)
	if !ok {
		return false
	}
	for _, stage := range pipeline {
		d, ok := stage.(bson.D)
		if !ok {
			continue
		}
		for _, elem := range d {
			if elem.Key == "$out" || elem.Key == "$merge" {
				return true
			}
		}
	}
	return false
}

// isWriteStatement is the read-only guard's per-statement verdict, checked before runStatement
// dispatches — SPEC.md's read-only contract disables "anything but a read", not console execution
// outright, so this must classify rather than blanket-refuse.
func isWriteStatement(stmt parsedStatement) bool {
	if stmt.method == "aggregate" {
		return isAggregateWrite(stmt)
	}
	return writeConsoleMethods[stmt.method]
}

// ClassifyStatement satisfies adapters.StatementClassifier (M2) over this package's own
// parseStatement/isWriteStatement — Mongo's grammar admits no schema statement (M2's model.
// MongoConsoleMethods is ten find/write/aggregate methods, no DDL), so DDL is unreachable here. A
// parse error returns ClassUnknown with the error rather than failing the classification silently.
func (a *Adapter) ClassifyStatement(_ context.Context, statement string) (adapters.OpClass, error) {
	stmt, err := parseStatement(statement)
	if err != nil {
		return adapters.ClassUnknown, err
	}
	if isWriteStatement(stmt) {
		return adapters.ClassWrite, nil
	}
	return adapters.ClassRead, nil
}

func parseStatement(text string) (parsedStatement, error) {
	parser, err := NewLiteralParser(strings.TrimSpace(text))
	if err != nil {
		return parsedStatement{}, err
	}
	if _, err := parser.ExpectIdent("db"); err != nil {
		return parsedStatement{}, err
	}
	if err := parser.ExpectPunct("."); err != nil {
		return parsedStatement{}, err
	}
	collection, err := parser.ExpectIdent("")
	if err != nil {
		return parsedStatement{}, err
	}
	if err := parser.ExpectPunct("."); err != nil {
		return parsedStatement{}, err
	}
	method, err := parser.ExpectIdent("")
	if err != nil {
		return parsedStatement{}, err
	}
	if !supportedConsoleMethods[method] {
		return parsedStatement{}, adapters.New(adapters.CodeUnsupported,
			"unsupported console method: db."+collection+"."+method+"()", nil)
	}
	if err := parser.ExpectPunct("("); err != nil {
		return parsedStatement{}, err
	}
	var args []any
	if !parser.PeekPunct(")") {
		v, err := parser.ParseValue()
		if err != nil {
			return parsedStatement{}, err
		}
		args = append(args, v)
		for parser.PeekPunct(",") {
			_ = parser.ExpectPunct(",")
			v, err := parser.ParseValue()
			if err != nil {
				return parsedStatement{}, err
			}
			args = append(args, v)
		}
	}
	if err := parser.ExpectPunct(")"); err != nil {
		return parsedStatement{}, err
	}
	if !parser.AtEnd() {
		return parsedStatement{}, adapters.New(adapters.CodeQuery, "unexpected trailing content after statement", nil)
	}
	return parsedStatement{collection: collection, method: method, args: args}, nil
}

func asDoc(value any, label string) (bson.D, error) {
	d, ok := value.(bson.D)
	if !ok {
		return nil, adapters.New(adapters.CodeQuery, label+" must be a document literal", nil)
	}
	return d, nil
}

func asDocArray(value any, label string) ([]bson.D, error) {
	a, ok := value.(bson.A)
	if !ok {
		return nil, adapters.New(adapters.CodeQuery, label+" must be an array", nil)
	}
	out := make([]bson.D, len(a))
	for i, v := range a {
		d, err := asDoc(v, label)
		if err != nil {
			return nil, err
		}
		out[i] = d
	}
	return out, nil
}

func docsToPage(docs []bson.D) (page.DocumentPage, error) {
	builder := page.NewDocumentPageBuilder(false)
	for _, doc := range docs {
		id := ""
		if idVal, ok := lookupField(doc, "_id"); ok {
			text, err := IDText(idVal)
			if err != nil {
				return page.DocumentPage{}, mapError(err)
			}
			id = text
		}
		body, err := ejsonStringify(doc, true)
		if err != nil {
			return page.DocumentPage{}, mapError(err)
		}
		builder.Push(id, body)
	}
	return builder.Finish(page.UnpagedPosition(len(docs))), nil
}

// statusPage mirrors mysql-family/console.go's singleStatusPage — console results that are an
// acknowledgement rather than a document set (insert/update/delete/count), one status "document"
// per statement.
func statusPage(status bson.D) (page.DocumentPage, error) {
	builder := page.NewDocumentPageBuilder(true)
	body, err := ejsonStringify(status, true)
	if err != nil {
		return page.DocumentPage{}, mapError(err)
	}
	builder.Push("", body)
	return builder.Finish(page.UnpagedPosition(1)), nil
}

func argOrEmptyDoc(args []any, i int, label string) (bson.D, error) {
	if i >= len(args) || args[i] == nil {
		return bson.D{}, nil
	}
	return asDoc(args[i], label)
}

// statementRunner is one console method's own body — runStatement's dispatch table maps a method
// name straight to its runner, the map miss taking the place of the old switch's default arm.
type statementRunner func(ctx context.Context, collection *mongodriver.Collection, stmt parsedStatement, op *adapters.OpCtx) (page.DocumentPage, error)

var statementRunners = map[string]statementRunner{
	"find":           runFind,
	"findOne":        runFindOne,
	"insertOne":      runInsertOne,
	"insertMany":     runInsertMany,
	"updateOne":      runUpdateOne,
	"updateMany":     runUpdateMany,
	"deleteOne":      runDeleteOne,
	"deleteMany":     runDeleteMany,
	"countDocuments": runCountDocuments,
	"aggregate":      runAggregate,
}

func runFind(ctx context.Context, collection *mongodriver.Collection, stmt parsedStatement, op *adapters.OpCtx) (page.DocumentPage, error) {
	filter, err := argOrEmptyDoc(stmt.args, 0, "find() filter")
	if err != nil {
		return page.DocumentPage{}, err
	}
	findOpts := options.Find().SetComment(op.OpID)
	if len(stmt.args) > 1 && stmt.args[1] != nil {
		projection, err := asDoc(stmt.args[1], "find() projection")
		if err != nil {
			return page.DocumentPage{}, err
		}
		findOpts.SetProjection(projection)
	}
	docs, err := adapters.RunWithAbortRace(ctx, func() {}, func(qctx context.Context) ([]bson.D, error) {
		cursor, err := collection.Find(qctx, filter, findOpts)
		if err != nil {
			return nil, mapError(err)
		}
		defer cursor.Close(qctx)
		var out []bson.D
		if err := cursor.All(qctx, &out); err != nil {
			return nil, mapError(err)
		}
		return out, nil
	})
	if err != nil {
		return page.DocumentPage{}, err
	}
	return docsToPage(docs)
}

func runFindOne(ctx context.Context, collection *mongodriver.Collection, stmt parsedStatement, op *adapters.OpCtx) (page.DocumentPage, error) {
	filter, err := argOrEmptyDoc(stmt.args, 0, "findOne() filter")
	if err != nil {
		return page.DocumentPage{}, err
	}
	doc, err := adapters.RunWithAbortRace(ctx, func() {}, func(qctx context.Context) (bson.D, error) {
		var out bson.D
		err := collection.FindOne(qctx, filter, options.FindOne().SetComment(op.OpID)).Decode(&out)
		if err != nil {
			if errors.Is(err, mongodriver.ErrNoDocuments) {
				return nil, nil
			}
			return nil, mapError(err)
		}
		return out, nil
	})
	if err != nil {
		return page.DocumentPage{}, err
	}
	if doc == nil {
		return docsToPage(nil)
	}
	return docsToPage([]bson.D{doc})
}

func runInsertOne(ctx context.Context, collection *mongodriver.Collection, stmt parsedStatement, op *adapters.OpCtx) (page.DocumentPage, error) {
	if len(stmt.args) == 0 {
		return page.DocumentPage{}, adapters.New(adapters.CodeQuery, "insertOne() document must be a document literal", nil)
	}
	doc, err := asDoc(stmt.args[0], "insertOne() document")
	if err != nil {
		return page.DocumentPage{}, err
	}
	result, err := adapters.RunWithAbortRace(ctx, func() {}, func(qctx context.Context) (*mongodriver.InsertOneResult, error) {
		r, err := collection.InsertOne(qctx, doc, options.InsertOne().SetComment(op.OpID))
		if err != nil {
			return nil, mapError(err)
		}
		return r, nil
	})
	if err != nil {
		return page.DocumentPage{}, err
	}
	return statusPage(bson.D{{Key: "acknowledged", Value: result.Acknowledged}, {Key: "insertedId", Value: result.InsertedID}})
}

func runInsertMany(ctx context.Context, collection *mongodriver.Collection, stmt parsedStatement, op *adapters.OpCtx) (page.DocumentPage, error) {
	if len(stmt.args) == 0 {
		return page.DocumentPage{}, adapters.New(adapters.CodeQuery, "insertMany() documents must be an array", nil)
	}
	docs, err := asDocArray(stmt.args[0], "insertMany() documents")
	if err != nil {
		return page.DocumentPage{}, err
	}
	anyDocs := make([]any, len(docs))
	for i, d := range docs {
		anyDocs[i] = d
	}
	result, err := adapters.RunWithAbortRace(ctx, func() {}, func(qctx context.Context) (*mongodriver.InsertManyResult, error) {
		r, err := collection.InsertMany(qctx, anyDocs, options.InsertMany().SetComment(op.OpID))
		if err != nil {
			return nil, mapError(err)
		}
		return r, nil
	})
	if err != nil {
		return page.DocumentPage{}, err
	}
	return statusPage(bson.D{{Key: "acknowledged", Value: result.Acknowledged}, {Key: "insertedCount", Value: len(result.InsertedIDs)}})
}

func runUpdateOne(ctx context.Context, collection *mongodriver.Collection, stmt parsedStatement, op *adapters.OpCtx) (page.DocumentPage, error) {
	if len(stmt.args) < 2 {
		return page.DocumentPage{}, adapters.New(adapters.CodeQuery, "updateOne() update must be a document literal", nil)
	}
	filter, err := asDoc(stmt.args[0], "updateOne() filter")
	if err != nil {
		return page.DocumentPage{}, err
	}
	update, err := asDoc(stmt.args[1], "updateOne() update")
	if err != nil {
		return page.DocumentPage{}, err
	}
	result, err := adapters.RunWithAbortRace(ctx, func() {}, func(qctx context.Context) (*mongodriver.UpdateResult, error) {
		r, err := collection.UpdateOne(qctx, filter, update, options.UpdateOne().SetComment(op.OpID))
		if err != nil {
			return nil, mapError(err)
		}
		return r, nil
	})
	if err != nil {
		return page.DocumentPage{}, err
	}
	return statusPage(bson.D{
		{Key: "matchedCount", Value: result.MatchedCount},
		{Key: "modifiedCount", Value: result.ModifiedCount},
		{Key: "upsertedId", Value: result.UpsertedID},
	})
}

func runUpdateMany(ctx context.Context, collection *mongodriver.Collection, stmt parsedStatement, op *adapters.OpCtx) (page.DocumentPage, error) {
	if len(stmt.args) < 2 {
		return page.DocumentPage{}, adapters.New(adapters.CodeQuery, "updateMany() update must be a document literal", nil)
	}
	filter, err := asDoc(stmt.args[0], "updateMany() filter")
	if err != nil {
		return page.DocumentPage{}, err
	}
	update, err := asDoc(stmt.args[1], "updateMany() update")
	if err != nil {
		return page.DocumentPage{}, err
	}
	result, err := adapters.RunWithAbortRace(ctx, func() {}, func(qctx context.Context) (*mongodriver.UpdateResult, error) {
		r, err := collection.UpdateMany(qctx, filter, update, options.UpdateMany().SetComment(op.OpID))
		if err != nil {
			return nil, mapError(err)
		}
		return r, nil
	})
	if err != nil {
		return page.DocumentPage{}, err
	}
	return statusPage(bson.D{
		{Key: "matchedCount", Value: result.MatchedCount},
		{Key: "modifiedCount", Value: result.ModifiedCount},
	})
}

func runDeleteOne(ctx context.Context, collection *mongodriver.Collection, stmt parsedStatement, op *adapters.OpCtx) (page.DocumentPage, error) {
	filter, err := argOrEmptyDoc(stmt.args, 0, "deleteOne() filter")
	if err != nil {
		return page.DocumentPage{}, err
	}
	result, err := adapters.RunWithAbortRace(ctx, func() {}, func(qctx context.Context) (*mongodriver.DeleteResult, error) {
		r, err := collection.DeleteOne(qctx, filter, options.DeleteOne().SetComment(op.OpID))
		if err != nil {
			return nil, mapError(err)
		}
		return r, nil
	})
	if err != nil {
		return page.DocumentPage{}, err
	}
	return statusPage(bson.D{{Key: "deletedCount", Value: result.DeletedCount}})
}

func runDeleteMany(ctx context.Context, collection *mongodriver.Collection, stmt parsedStatement, op *adapters.OpCtx) (page.DocumentPage, error) {
	filter, err := argOrEmptyDoc(stmt.args, 0, "deleteMany() filter")
	if err != nil {
		return page.DocumentPage{}, err
	}
	result, err := adapters.RunWithAbortRace(ctx, func() {}, func(qctx context.Context) (*mongodriver.DeleteResult, error) {
		r, err := collection.DeleteMany(qctx, filter, options.DeleteMany().SetComment(op.OpID))
		if err != nil {
			return nil, mapError(err)
		}
		return r, nil
	})
	if err != nil {
		return page.DocumentPage{}, err
	}
	return statusPage(bson.D{{Key: "deletedCount", Value: result.DeletedCount}})
}

func runCountDocuments(ctx context.Context, collection *mongodriver.Collection, stmt parsedStatement, op *adapters.OpCtx) (page.DocumentPage, error) {
	filter, err := argOrEmptyDoc(stmt.args, 0, "countDocuments() filter")
	if err != nil {
		return page.DocumentPage{}, err
	}
	count, err := adapters.RunWithAbortRace(ctx, func() {}, func(qctx context.Context) (int64, error) {
		n, err := collection.CountDocuments(qctx, filter, options.Count().SetComment(op.OpID))
		if err != nil {
			return 0, mapError(err)
		}
		return n, nil
	})
	if err != nil {
		return page.DocumentPage{}, err
	}
	return statusPage(bson.D{{Key: "count", Value: count}})
}

func runAggregate(ctx context.Context, collection *mongodriver.Collection, stmt parsedStatement, op *adapters.OpCtx) (page.DocumentPage, error) {
	var pipeline []bson.D
	if len(stmt.args) > 0 && stmt.args[0] != nil {
		p, err := asDocArray(stmt.args[0], "aggregate() pipeline")
		if err != nil {
			return page.DocumentPage{}, err
		}
		pipeline = p
	}
	docs, err := adapters.RunWithAbortRace(ctx, func() {}, func(qctx context.Context) ([]bson.D, error) {
		cursor, err := collection.Aggregate(qctx, pipeline, options.Aggregate().SetComment(op.OpID))
		if err != nil {
			return nil, mapError(err)
		}
		defer cursor.Close(qctx)
		var out []bson.D
		if err := cursor.All(qctx, &out); err != nil {
			return nil, mapError(err)
		}
		return out, nil
	})
	if err != nil {
		return page.DocumentPage{}, err
	}
	return docsToPage(docs)
}

func runStatement(ctx context.Context, db *mongodriver.Database, stmt parsedStatement, op *adapters.OpCtx) (page.DocumentPage, error) {
	runner, ok := statementRunners[stmt.method]
	if !ok {
		return page.DocumentPage{}, adapters.New(adapters.CodeUnsupported,
			"unsupported console method: db."+stmt.collection+"."+stmt.method+"()", nil)
	}
	return runner(ctx, db.Collection(stmt.collection), stmt, op)
}

// execute ports console.ts's execute — one op-log row for the whole batch (P5.5 D9), CheckCancelled
// between statements, one page per statement.
func execute(ctx context.Context, db *mongodriver.Database, readOnly bool, op *adapters.OpCtx, statements []string) ([]page.Page, error) {
	if len(statements) == 0 {
		return nil, adapters.New(adapters.CodeQuery, "no statements to execute", nil)
	}
	op.SetCommand(strings.Join(statements, ";\n"))

	pages := make([]page.Page, 0, len(statements))
	for _, text := range statements {
		if err := adapters.CheckCancelled(ctx); err != nil {
			return nil, err
		}
		stmt, err := parseStatement(text)
		if err != nil {
			return nil, err
		}
		if readOnly && isWriteStatement(stmt) {
			return nil, adapters.AssertWritable(true)
		}
		p, err := runStatement(ctx, db, stmt, op)
		if err != nil {
			return nil, err
		}
		pages = append(pages, p)
	}
	return pages, nil
}
