package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// ApiDataChange names one renderer cache a mutation made stale (P112). Kind is one of the four
// consts below; ItemID is set only for savedRequest, Scope/OwnerID only for variables.
type ApiDataChange struct {
	Kind    string              `json:"kind"`
	ItemID  string              `json:"itemId,omitempty"`
	Scope   model.VariableScope `json:"scope,omitempty"`
	OwnerID string              `json:"ownerId,omitempty"`
}

const (
	ApiDataTree         = "tree"         // collections + items list (names, method/url summary, order)
	ApiDataSavedRequest = "savedRequest" // one item's saved HTTP or gRPC body
	ApiDataVariables    = "variables"    // one owner's variable rows
	ApiDataEnvironments = "environments" // environment list, including is_active
)

// ApiDataChanged is ChannelApiDataChanged's payload: every scope one mutation touched, in one
// event, so the renderer invalidates them in one batch.
type ApiDataChanged struct {
	Changes []ApiDataChange `json:"changes"`
}

func emitApiData(e appcore.Emitter, changes ...ApiDataChange) {
	e.Emit(ChannelApiDataChanged, ApiDataChanged{Changes: changes})
}

func treeChange() ApiDataChange { return ApiDataChange{Kind: ApiDataTree} }

func savedRequestChange(itemID string) ApiDataChange {
	return ApiDataChange{Kind: ApiDataSavedRequest, ItemID: itemID}
}

func variablesChange(scope model.VariableScope, ownerID string) ApiDataChange {
	return ApiDataChange{Kind: ApiDataVariables, Scope: scope, OwnerID: ownerID}
}

func environmentsChange() ApiDataChange { return ApiDataChange{Kind: ApiDataEnvironments} }
