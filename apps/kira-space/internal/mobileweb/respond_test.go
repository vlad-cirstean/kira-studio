package mobileweb

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/packages/theme/src/i18n"
)

func TestWriteServiceErrorConflictKeepsCatalogText(t *testing.T) {
	t.Parallel()
	const key = "backend.space.ade.workflowChanged.body"
	rec := httptest.NewRecorder()
	writeServiceError(rec, ipcerr.T(ipcerr.CodeConflict, key, nil))
	want := i18n.T("backend.space.ade.workflowChanged.body", nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	var body errorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Code != string(ipcerr.CodeConflict) || body.Message != want {
		t.Fatalf("body = %+v, want E_CONFLICT with %q", body, want)
	}
}
