package shell_test

import (
	"os"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// testApp is the one *application.App every shell_test file shares — application.New
// short-circuits on a non-nil globalApplication (application.go:49-51), so a test binary gets
// exactly one *App for its whole life (P56 §1.7, probed). Tests must use distinct event names or
// unsubscribe, and none of them may call Run().
var testApp *application.App

func TestMain(m *testing.M) {
	testApp = application.New(application.Options{Name: "Kira Studio Test"})
	os.Exit(m.Run())
}
