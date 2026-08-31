package s3

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// P33 D2/F10's sentinels, mirrored from src/shared/domain/object-store.ts — edit, delete and
// upload ride the existing mutate() path with the same sentinel-through-RowValues technique
// redis/mutate.go established.
const (
	objectKeySentinel         = "_key"
	objectValueSentinel       = "$value"
	objectFileSentinel        = "$file"
	objectContentTypeSentinel = "$contentType"
)

func resolveBucketSegment(path model.NodePath) (string, error) {
	if len(path.Segments) == 0 || path.Segments[0].Kind != "bucket" {
		return "", adapters.New(adapters.CodeNotFound, "mutate requires a bucket-rooted path, got: "+model.EncodePath(path.Segments), nil)
	}
	return path.Segments[0].Name, nil
}

func keyFrom(values model.RowValues, label string) (string, error) {
	raw, ok := values.Get(objectKeySentinel)
	if !ok || raw == nil || *raw == "" {
		return "", adapters.New(adapters.CodeQuery, fmt.Sprintf("an s3 %s mutation requires a non-empty %s", label, objectKeySentinel), nil)
	}
	return *raw, nil
}

func valueFrom(values model.RowValues, label string) (string, error) {
	raw, ok := values.Get(objectValueSentinel)
	if !ok || raw == nil {
		return "", adapters.New(adapters.CodeUnsupported, fmt.Sprintf("an s3 %s mutation requires a %s", label, objectValueSentinel), nil)
	}
	return *raw, nil
}

func fileFrom(values model.RowValues) (string, error) {
	raw, ok := values.Get(objectFileSentinel)
	if !ok || raw == nil || *raw == "" {
		return "", adapters.New(adapters.CodeUnsupported, "an s3 insert mutation requires a non-empty "+objectFileSentinel, nil)
	}
	return *raw, nil
}

func contentTypeFrom(values model.RowValues) *string {
	raw, ok := values.Get(objectContentTypeSentinel)
	if !ok || raw == nil || *raw == "" {
		return nil
	}
	return raw
}

// preview is mutate.ts's preview — synchronous (Adapter rule 3), no network call.
func preview(plan model.MutationPlan) ([]string, error) {
	bucket, err := resolveBucketSegment(plan.Path)
	if err != nil {
		return nil, err
	}
	out := make([]string, len(plan.Ops))
	for i, op := range plan.Ops {
		text, err := renderOpText(bucket, op)
		if err != nil {
			return nil, err
		}
		out[i] = text
	}
	return out, nil
}

func renderOpText(bucket string, op model.MutationRowOp) (string, error) {
	switch op.Kind {
	case "update":
		key, err := keyFrom(op.Key, "update")
		if err != nil {
			return "", err
		}
		value, err := valueFrom(op.Changes, "update")
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("PutObject s3://%s/%s (%s)", bucket, key, formatBytes(int64(len(value)))), nil
	case "delete":
		key, err := keyFrom(op.Key, "delete")
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("DeleteObject s3://%s/%s", bucket, key), nil
	default: // insert
		key, err := keyFrom(op.Values, "insert")
		if err != nil {
			return "", err
		}
		file, err := fileFrom(op.Values)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("PutObject s3://%s/%s <- %s", bucket, key, file), nil
	}
}

// preservedAttributes is mutate.ts's preservedAttributes (P58d D13): carries over every attribute
// HeadObject returns and PutObject accepts. PutObject replaces an object wholesale, so anything
// not resent here is gone — silently turning application/json into binary/octet-stream, or
// dropping Content-Encoding: gzip, would change how the object is served to everything downstream.
func applyPreservedAttributes(in *s3.PutObjectInput, head *s3.HeadObjectOutput) {
	if head.ContentType != nil {
		in.ContentType = head.ContentType
	}
	if head.CacheControl != nil {
		in.CacheControl = head.CacheControl
	}
	if head.ContentEncoding != nil {
		in.ContentEncoding = head.ContentEncoding
	}
	if head.ContentDisposition != nil {
		in.ContentDisposition = head.ContentDisposition
	}
	if head.ContentLanguage != nil {
		in.ContentLanguage = head.ContentLanguage
	}
	if head.StorageClass != "" {
		in.StorageClass = head.StorageClass
	}
	if head.Metadata != nil {
		in.Metadata = head.Metadata
	}
}

func applyUpdate(ctx context.Context, client *s3.Client, bucket string, op model.MutationRowOp) error {
	key, err := keyFrom(op.Key, "update")
	if err != nil {
		return err
	}
	value, err := valueFrom(op.Changes, "update")
	if err != nil {
		return err
	}
	head, err := client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	if err != nil {
		return mapError(err)
	}
	in := &s3.PutObjectInput{Bucket: aws.String(bucket), Key: aws.String(key), Body: strings.NewReader(value)}
	applyPreservedAttributes(in, head)
	if _, err := client.PutObject(ctx, in); err != nil {
		return mapError(err)
	}
	return nil
}

func applyInsert(ctx context.Context, client *s3.Client, bucket string, op model.MutationRowOp) error {
	key, err := keyFrom(op.Values, "insert")
	if err != nil {
		return err
	}
	// NX-equivalent: HeadObject first (P58d D14) — PutObject has no conditional-create option, so
	// this is the only way to refuse a collision rather than silently overwriting. Matches on
	// *types.NotFound structurally: anything but a real 404 fails the insert rather than proceeding
	// (a tightening from the TypeScript's "any query-level error" fallthrough).
	_, err = client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	if err == nil {
		return adapters.New(adapters.CodeQuery, "key already exists: "+key, nil)
	}
	var notFound *types.NotFound
	if !errors.As(err, &notFound) {
		return mapError(err)
	}

	sourcePath, err := fileFrom(op.Values)
	if err != nil {
		return err
	}
	body, size, err := openUploadBody(sourcePath)
	if err != nil {
		return err
	}
	defer body.Close()

	in := &s3.PutObjectInput{
		Bucket: aws.String(bucket), Key: aws.String(key), Body: body,
		ContentLength: aws.Int64(size), ContentType: contentTypeFrom(op.Values),
	}
	if _, err := client.PutObject(ctx, in); err != nil {
		return mapError(err)
	}
	return nil
}

func applyDelete(ctx context.Context, client *s3.Client, bucket string, op model.MutationRowOp) error {
	key, err := keyFrom(op.Key, "delete")
	if err != nil {
		return err
	}
	if _, err := client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)}); err != nil {
		return mapError(err)
	}
	if _, err := client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)}); err != nil {
		return mapError(err)
	}
	return nil
}

// mutate is mutate.ts's mutate.
func mutate(ctx context.Context, client *s3.Client, op *adapters.OpCtx, readOnly bool, plan model.MutationPlan) (model.MutationResult, error) {
	if err := adapters.AssertWritable(readOnly); err != nil {
		return model.MutationResult{}, err
	}
	bucket, err := resolveBucketSegment(plan.Path)
	if err != nil {
		return model.MutationResult{}, err
	}
	statements, err := preview(plan)
	if err != nil {
		return model.MutationResult{}, err
	}
	commandText := ""
	for i, s := range statements {
		if i > 0 {
			commandText += ";\n"
		}
		commandText += s
	}
	op.SetCommand(commandText)

	affectedRows := 0
	for _, rowOp := range plan.Ops {
		if err := adapters.CheckCancelled(ctx); err != nil {
			return model.MutationResult{}, err
		}
		var opErr error
		switch rowOp.Kind {
		case "update":
			opErr = applyUpdate(ctx, client, bucket, rowOp)
		case "delete":
			opErr = applyDelete(ctx, client, bucket, rowOp)
		default:
			opErr = applyInsert(ctx, client, bucket, rowOp)
		}
		if opErr != nil {
			return model.MutationResult{}, opErr
		}
		affectedRows++
	}

	return model.MutationResult{AffectedRows: affectedRows}, nil
}
