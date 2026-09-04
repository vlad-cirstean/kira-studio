package bridge

import (
	"fmt"
	"os"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/postman"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// CollectionsService is P4 D11 — the QueriesService shape (a typed-struct wrapper per method, with
// an explicit guard and an ipcerr translation) over Deps.Repos.Collections, plus the two file
// methods.
//
// **Go reads and writes the file.** P3 §2 F7 measured the control plane: CHUNK_THRESHOLD is
// 512 KiB with a serial fetch per chunk and an outright refusal above a 64 MiB assembled body, so
// a 10-50 MB collection through the renderer would be 20-100 serial round trips and, above the
// ceiling, an unattributable "assembled body too large". The renderer's whole involvement is a
// path string from FilesService.ChooseOpen/ChooseSave — the identical shape P3 D4 established for
// a request body's file.
//
// **No op-log row and no new op kind.** The ring-and-Stop machinery ARCHITECTURE.md's ~150 ms
// invariant refers to is ViewChrome + useRunState(tabId), which is per tab; an import initiated
// from the left panel has no tab, so joining the op log would buy an Operations-panel row and
// nothing the user is looking at. Cancelling a single all-or-nothing local transaction has no
// useful semantics either. The panel's own header action carries a spinner instead, and Wails
// handles each bound call in its own goroutine (P2 §2 F12), so a long import blocks that call and
// nothing else.
type CollectionsService struct{ Deps appcore.Deps }

// CollectionSummary and ItemSummary are the two flat row shapes the tree renders from — the
// renderer builds the tree, mirroring how TreeService.Children returns flat nodes.
type CollectionSummary = model.Collection

// ItemSummary is model.CollectionItem under the name the renderer's own mirror uses.
type ItemSummary = model.CollectionItem

// CollectionsTree is one List() answer: flat arrays, one call per panel mount, no N+1.
type CollectionsTree struct {
	Collections []CollectionSummary `json:"collections"`
	Items       []ItemSummary       `json:"items"`
}

func (s *CollectionsService) List() (CollectionsTree, error) {
	collections, items, err := s.Deps.Repos.Collections.List()
	if err != nil {
		return CollectionsTree{}, ipcerr.Internal(err.Error())
	}
	return CollectionsTree{Collections: collections, Items: items}, nil
}

type CollectionsItemArgs struct {
	ItemID string `json:"itemId"`
}

func (s *CollectionsService) GetRequest(args CollectionsItemArgs) (model.SavedRequest, error) {
	if args.ItemID == "" {
		return model.SavedRequest{}, ipcerr.BadRequest("itemId is required")
	}
	req, err := s.Deps.Repos.Collections.GetRequest(args.ItemID)
	if err != nil {
		return model.SavedRequest{}, ipcerr.Internal(err.Error())
	}
	return req, nil
}

type CollectionsSaveRequestArgs struct {
	ItemID  string             `json:"itemId"`
	Name    string             `json:"name"`
	Request model.SavedRequest `json:"request"`
}

func (s *CollectionsService) SaveRequest(args CollectionsSaveRequestArgs) (ItemSummary, error) {
	if args.ItemID == "" {
		return ItemSummary{}, ipcerr.BadRequest("itemId is required")
	}
	if args.Name == "" {
		return ItemSummary{}, ipcerr.BadRequest("name is required")
	}
	item, err := s.Deps.Repos.Collections.SaveRequest(args.ItemID, args.Name, args.Request)
	if err != nil {
		return ItemSummary{}, ipcerr.Internal(err.Error())
	}
	return item, nil
}

type CollectionsCreateCollectionArgs struct {
	Name string `json:"name"`
}

func (s *CollectionsService) CreateCollection(args CollectionsCreateCollectionArgs) (CollectionSummary, error) {
	if args.Name == "" {
		return CollectionSummary{}, ipcerr.BadRequest("name is required")
	}
	c, err := s.Deps.Repos.Collections.CreateCollection(args.Name)
	if err != nil {
		return CollectionSummary{}, ipcerr.Internal(err.Error())
	}
	return c, nil
}

type CollectionsCreateItemArgs struct {
	CollectionID string              `json:"collectionId"`
	ParentID     *string             `json:"parentId"`
	Kind         string              `json:"kind"`
	Name         string              `json:"name"`
	Request      *model.SavedRequest `json:"request"`
}

func (s *CollectionsService) CreateItem(args CollectionsCreateItemArgs) (ItemSummary, error) {
	if args.CollectionID == "" {
		return ItemSummary{}, ipcerr.BadRequest("collectionId is required")
	}
	if !model.IsCollectionItemKind(args.Kind) {
		return ItemSummary{}, ipcerr.BadRequest("kind must be 'folder' or 'request'")
	}
	if args.Name == "" {
		return ItemSummary{}, ipcerr.BadRequest("name is required")
	}
	item, err := s.Deps.Repos.Collections.CreateItem(args.CollectionID, args.ParentID, args.Kind, args.Name, args.Request)
	if err != nil {
		return ItemSummary{}, ipcerr.Internal(err.Error())
	}
	return item, nil
}

// CollectionsTargetArgs names a row in either table — 'collection' or 'item' — so the renderer
// never has to know which one a tree row lives in.
type CollectionsTargetArgs struct {
	ID     string `json:"id"`
	Target string `json:"target"`
	Name   string `json:"name,omitempty"`
}

func (s *CollectionsService) Rename(args CollectionsTargetArgs) error {
	if err := validTarget(args); err != nil {
		return err
	}
	if args.Name == "" {
		return ipcerr.BadRequest("name is required")
	}
	if err := s.Deps.Repos.Collections.Rename(args.ID, args.Target, args.Name); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}

func (s *CollectionsService) Delete(args CollectionsTargetArgs) error {
	if err := validTarget(args); err != nil {
		return err
	}
	if err := s.Deps.Repos.Collections.Delete(args.ID, args.Target); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}

func validTarget(args CollectionsTargetArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	if args.Target != "collection" && args.Target != "item" {
		return ipcerr.BadRequest("target must be 'collection' or 'item'")
	}
	return nil
}

// ImportWarning is one counted class of "the app quietly did something other than what the file
// said" (D12). Counted rather than listed per-item: the point is that the user learns it at import
// time rather than from a confusing 401 or an E_BAD_REQUEST minutes later.
type ImportWarning struct {
	Kind   string `json:"kind"`
	Count  int    `json:"count"`
	Detail string `json:"detail"`
}

// ImportReport is what Import answers with — part of the feature, not decoration.
type ImportReport struct {
	CollectionID string          `json:"collectionId"`
	Name         string          `json:"name"`
	Folders      int             `json:"folders"`
	Requests     int             `json:"requests"`
	Warnings     []ImportWarning `json:"warnings"`
}

// importWarningDetail is D12's table: one sentence per warning kind, in the order they are
// reported. %d is the count. The messages live here rather than in internal/postman because they
// are UI text — that package only knows what it did.
var importWarningDetail = []struct {
	kind   string
	detail string
}{
	{postman.WarnScriptsInert, "%d pre-request/test scripts were kept but are not run — they survive an export unchanged."},
	{postman.WarnAuthInert, "%d requests or folders carry an auth block. It is kept but not applied — those requests will need an Authorization header."},
	{postman.WarnVariablesInert, "%d folder- or item-level variables were kept but are not resolved yet."},
	{postman.WarnVariablesImported, "%d collection variables were imported."},
	{postman.WarnGraphQLBody, "%d GraphQL bodies were imported as JSON bodies carrying the same query."},
	{postman.WarnUnsupportedMethod, "%d requests use a method this builder cannot show yet and will open as GET."},
	{postman.WarnUnresolvedFile, "%d requests reference a file by a name or a path from another machine."},
	{postman.WarnInlineFileContent, "%d binary bodies carry inline content rather than a file. The content is kept, but a file must be chosen before sending."},
	{postman.WarnDisabledBody, "%d request bodies are switched off in Postman. They are kept, and this app will send them."},
	{postman.WarnMalformedItem, "%d items were neither a folder nor a request and were skipped."},
}

type CollectionsImportArgs struct {
	Path string `json:"path"`
}

// Import parses the file at path and writes it as rows in one transaction. Only the path crosses
// the bridge — never the file's bytes (F16).
func (s *CollectionsService) Import(args CollectionsImportArgs) (ImportReport, error) {
	if args.Path == "" {
		return ImportReport{}, ipcerr.BadRequest("path is required")
	}
	f, err := os.Open(args.Path)
	if err != nil {
		return ImportReport{}, ipcerr.BadRequest(fmt.Sprintf("could not read %s: %s", args.Path, err))
	}
	defer f.Close()

	tree, err := postman.Parse(f)
	if err != nil {
		// A refusal here is about the file's own content (D10's version gate, or JSON that is not
		// a collection at all), which is the user's to fix — not an internal failure.
		return ImportReport{}, ipcerr.BadRequest(err.Error())
	}
	collection, err := s.Deps.Repos.Collections.ImportTree(tree)
	if err != nil {
		return ImportReport{}, ipcerr.Internal(err.Error())
	}
	// D15/F13: a second call, deliberately — encrypting a secret variable needs VariablesRepo's
	// own Cipher, which CollectionsRepo does not have (D4/F4's module boundary). See
	// VariablesRepo.ImportVariables' own comment for why this cannot join ImportTree's transaction.
	if len(tree.Variables) > 0 {
		if err := s.Deps.Repos.Variables.ImportVariables(collection.ID, tree.Variables); err != nil {
			return ImportReport{}, ipcerr.Internal(err.Error())
		}
	}

	report := ImportReport{
		CollectionID: collection.ID, Name: collection.Name,
		Folders: tree.Report.Folders, Requests: tree.Report.Requests,
		Warnings: []ImportWarning{},
	}
	for _, w := range importWarningDetail {
		count := tree.Report.Warnings[w.kind]
		if count == 0 {
			continue
		}
		report.Warnings = append(report.Warnings, ImportWarning{
			Kind: w.kind, Count: count, Detail: fmt.Sprintf(w.detail, count),
		})
	}
	return report, nil
}

type CollectionsExportArgs struct {
	CollectionID string `json:"collectionId"`
	Path         string `json:"path"`
}

// ExportReport is Export's answer — D16: a secret is written valueless, and SecretCount is what
// lets the renderer say so once, rather than that being a fact only discoverable by opening the
// file.
type ExportReport struct {
	SecretCount int `json:"secretCount"`
}

// Export writes the collection at path as Collection v2.1 JSON. The file is written whole rather
// than streamed: a collection is rows in a local table and the writer needs the tree in memory to
// rebuild the nested arrays anyway.
func (s *CollectionsService) Export(args CollectionsExportArgs) (ExportReport, error) {
	if args.CollectionID == "" {
		return ExportReport{}, ipcerr.BadRequest("collectionId is required")
	}
	if args.Path == "" {
		return ExportReport{}, ipcerr.BadRequest("path is required")
	}
	tree, err := s.Deps.Repos.Collections.LoadTree(args.CollectionID)
	if err != nil {
		return ExportReport{}, ipcerr.Internal(err.Error())
	}
	f, err := os.Create(args.Path)
	if err != nil {
		return ExportReport{}, ipcerr.BadRequest(fmt.Sprintf("could not write %s: %s", args.Path, err))
	}
	if err := postman.Write(f, tree); err != nil {
		_ = f.Close()
		return ExportReport{}, ipcerr.Internal(err.Error())
	}
	if err := f.Close(); err != nil {
		return ExportReport{}, ipcerr.Internal(fmt.Sprintf("could not finish writing %s: %s", args.Path, err))
	}

	secretCount := 0
	for _, v := range tree.Variables {
		if v.Secret {
			secretCount++
		}
	}
	return ExportReport{SecretCount: secretCount}, nil
}
