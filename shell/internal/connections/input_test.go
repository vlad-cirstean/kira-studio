package connections

import (
	"errors"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func validInput() Input {
	host := "localhost"
	port := 5432
	return Input{
		ConnectionFields: model.ConnectionFields{
			Name:    "my db",
			Kind:    "postgres",
			Color:   "blue",
			Mode:    "fields",
			Host:    &host,
			Port:    &port,
			Options: map[string]any{},
		},
	}
}

func mustBadRequest(t *testing.T, err error, want string) {
	t.Helper()
	if err == nil {
		t.Fatalf("Validate() = nil, want E_BAD_REQUEST %q", want)
	}
	var ie *ipcerr.Error
	if !errors.As(err, &ie) {
		t.Fatalf("Validate() error %v (%T) is not an *ipcerr.Error", err, err)
	}
	if ie.Code != "E_BAD_REQUEST" {
		t.Errorf("Code = %q, want E_BAD_REQUEST", ie.Code)
	}
	if ie.Message != want {
		t.Errorf("Message = %q, want %q", ie.Message, want)
	}
}

func TestValidate(t *testing.T) {
	t.Run("valid input passes", func(t *testing.T) {
		if err := validInput().Validate(); err != nil {
			t.Fatalf("Validate() = %v, want nil", err)
		}
	})

	t.Run("empty name", func(t *testing.T) {
		in := validInput()
		in.Name = "   "
		mustBadRequest(t, in.Validate(), "name must be 1-120 characters")
	})

	t.Run("name too long", func(t *testing.T) {
		in := validInput()
		long := make([]byte, 121)
		for i := range long {
			long[i] = 'a'
		}
		in.Name = string(long)
		mustBadRequest(t, in.Validate(), "name must be 1-120 characters")
	})

	t.Run("invalid kind", func(t *testing.T) {
		in := validInput()
		in.Kind = "bogus"
		mustBadRequest(t, in.Validate(), "invalid connection kind")
	})

	t.Run("invalid color", func(t *testing.T) {
		in := validInput()
		in.Color = "bogus"
		mustBadRequest(t, in.Validate(), "invalid connection color")
	})

	t.Run("invalid mode", func(t *testing.T) {
		in := validInput()
		in.Mode = "bogus"
		mustBadRequest(t, in.Validate(), "invalid connection mode")
	})

	t.Run("port too low", func(t *testing.T) {
		in := validInput()
		port := 0
		in.Port = &port
		mustBadRequest(t, in.Validate(), "port must be between 1 and 65535")
	})

	t.Run("port too high", func(t *testing.T) {
		in := validInput()
		port := 65536
		in.Port = &port
		mustBadRequest(t, in.Validate(), "port must be between 1 and 65535")
	})

	t.Run("blank preconnect", func(t *testing.T) {
		in := validInput()
		blank := "   "
		in.Preconnect = &blank
		mustBadRequest(t, in.Validate(), "preconnect must be 1-2000 characters")
	})

	t.Run("preconnect too long", func(t *testing.T) {
		in := validInput()
		long := make([]byte, 2001)
		for i := range long {
			long[i] = 'a'
		}
		s := string(long)
		in.Preconnect = &s
		mustBadRequest(t, in.Validate(), "preconnect must be 1-2000 characters")
	})

	t.Run("sqlite requires a database path", func(t *testing.T) {
		in := validInput()
		in.Kind = "sqlite"
		in.Host = nil
		in.Port = nil
		in.Database = nil
		mustBadRequest(t, in.Validate(), "A database file is required.")
	})

	t.Run("sqlite database must be absolute", func(t *testing.T) {
		in := validInput()
		in.Kind = "sqlite"
		in.Host = nil
		in.Port = nil
		rel := "relative/path.db"
		in.Database = &rel
		mustBadRequest(t, in.Validate(), "The database file must be an absolute path.")
	})

	t.Run("sqlite with absolute path passes", func(t *testing.T) {
		in := validInput()
		in.Kind = "sqlite"
		in.Host = nil
		in.Port = nil
		abs := "/tmp/db.sqlite"
		in.Database = &abs
		if err := in.Validate(); err != nil {
			t.Fatalf("Validate() = %v, want nil", err)
		}
	})

	t.Run("fields mode requires host", func(t *testing.T) {
		in := validInput()
		in.Host = nil
		mustBadRequest(t, in.Validate(), "Host is required.")
	})

	t.Run("fields mode requires port", func(t *testing.T) {
		in := validInput()
		in.Port = nil
		mustBadRequest(t, in.Validate(), "Port is required.")
	})

	t.Run("aws-style kind needs neither host nor port", func(t *testing.T) {
		in := validInput()
		in.Kind = "s3"
		in.Host = nil
		in.Port = nil
		if err := in.Validate(); err != nil {
			t.Fatalf("Validate() = %v, want nil", err)
		}
	})

	t.Run("uri mode requires a uri", func(t *testing.T) {
		in := validInput()
		in.Mode = "uri"
		in.Host = nil
		in.Port = nil
		mustBadRequest(t, in.Validate(), "A connection URI is required.")
	})

	t.Run("uri mode with blank uri", func(t *testing.T) {
		in := validInput()
		in.Mode = "uri"
		in.Host = nil
		in.Port = nil
		blank := "   "
		in.URI = &blank
		mustBadRequest(t, in.Validate(), "A connection URI is required.")
	})

	t.Run("uri mode with a uri passes", func(t *testing.T) {
		in := validInput()
		in.Mode = "uri"
		in.Host = nil
		in.Port = nil
		uri := "postgresql://u@h/db"
		in.URI = &uri
		if err := in.Validate(); err != nil {
			t.Fatalf("Validate() = %v, want nil", err)
		}
	})
}
