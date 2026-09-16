package bridge

import "testing"

func TestLinkService_OpenExternal(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		wantErr bool
	}{
		{name: "https URL accepted", url: "https://example.com/some/page"},
		{name: "http URL accepted", url: "http://example.com/some/page"},
		{name: "javascript scheme rejected", url: "javascript:alert(1)", wantErr: true},
		{name: "file scheme rejected", url: "file:///etc/passwd", wantErr: true},
		{name: "no host rejected", url: "https:///pull/42", wantErr: true},
		{name: "unparseable rejected", url: "not a url", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			browser := &fakeBrowser{}
			svc := &LinkService{Browser: browser}
			err := svc.OpenExternal(LinkOpenExternalArgs{URL: tt.url})
			if tt.wantErr {
				if err == nil {
					t.Fatalf("OpenExternal(%q) = nil error, want one", tt.url)
				}
				if browser.calls != 0 {
					t.Fatalf("OpenExternal(%q): browser.OpenURL called on a rejected URL", tt.url)
				}
				return
			}
			if err != nil {
				t.Fatalf("OpenExternal(%q): %v", tt.url, err)
			}
			if browser.opened != tt.url {
				t.Fatalf("browser.opened = %q, want %q", browser.opened, tt.url)
			}
		})
	}
}
