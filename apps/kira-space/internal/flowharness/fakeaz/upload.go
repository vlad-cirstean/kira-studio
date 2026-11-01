package fakeaz

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// devopsResource is Azure DevOps' Entra ID resource id; the provider must ask for exactly this.
const devopsResource = "499b84ac-1321-427f-aa17-267ca6975798"

// Token is the bearer token the fake issues.
const Token = "fake-token"

// Upload is one attachment the fake DevOps kept.
type Upload struct {
	Name, SHA256 string
	Size         int
}

func (a *Az) accessToken(args []string) ([]byte, error) {
	if flagValue(args, "--resource") != devopsResource || flagValue(args, "--query") != "accessToken" || flagValue(args, "-o") != "tsv" {
		a.violations = append(a.violations, strings.Join(args, " "))
		return nil, a.unsupported(args)
	}
	a.calls = append(a.calls, "token")
	if !a.loggedIn || a.noToken {
		return nil, fail("ERROR: Please run 'az login' to setup account.")
	}
	return []byte(Token + "\n"), nil
}

// Uploads returns the attachments held for pull request id, in upload order.
func (a *Az) Uploads(id int) []Upload {
	a.mu.Lock()
	defer a.mu.Unlock()
	return slices.Clone(a.uploads[id])
}

var attachmentPath = regexp.MustCompile(`^/([^/]+)/([^/]+)/_apis/git/repositories/([^/]+)/pullRequests/(\d+)/attachments/([^/]+)$`)

type transport struct{ a *Az }

// Transport is an in-process stand-in for dev.azure.com's attachment endpoint. It rejects any
// request that is not a well-formed, authorised upload or delete.
func (a *Az) Transport() http.RoundTripper { return transport{a} }

func reply(code int, req *http.Request, body string) *http.Response {
	return &http.Response{
		StatusCode: code, Status: strconv.Itoa(code), Proto: "HTTP/1.1", Header: http.Header{"Content-Type": {"application/json"}},
		Body: io.NopCloser(strings.NewReader(body)), Request: req,
	}
}

func (t transport) RoundTrip(req *http.Request) (*http.Response, error) {
	a := t.a
	a.mu.Lock()
	defer a.mu.Unlock()
	m := attachmentPath.FindStringSubmatch(req.URL.EscapedPath())
	bad := func() (*http.Response, error) {
		a.violations = append(a.violations, "http "+req.Method+" "+req.URL.Host+req.URL.Path)
		return reply(http.StatusBadRequest, req, `{}`), nil
	}
	if req.URL.Scheme != "https" || req.URL.Host != "dev.azure.com" || m == nil || req.URL.Query().Get("api-version") != "7.1" ||
		req.Header.Get("Authorization") != "Bearer "+Token {
		return bad()
	}
	id, _ := strconv.Atoi(m[4])
	name, err := url.PathUnescape(m[5])
	if err != nil {
		return bad()
	}
	switch req.Method {
	case http.MethodPost:
		if req.Header.Get("Content-Type") != "application/octet-stream" {
			return bad()
		}
		data, _ := io.ReadAll(req.Body)
		a.calls = append(a.calls, "upload:"+m[4]+":"+name)
		if code := a.uploadCode; code != 0 {
			a.uploadCode = 0
			resp := reply(code, req, `{"message":"forced"}`)
			if code == http.StatusTooManyRequests {
				resp.Header.Set("Retry-After", "30")
			}
			return resp, nil
		}
		if _, _, ok := a.find(id); !ok {
			return reply(http.StatusNotFound, req, `{}`), nil
		}
		sum := sha256.Sum256(data)
		a.uploads[id] = append(a.uploads[id], Upload{Name: name, Size: len(data), SHA256: hex.EncodeToString(sum[:])})
		link := "https://dev.azure.com/" + m[1] + "/" + m[2] + "/_apis/git/repositories/" + m[3] + "/pullRequests/" + m[4] + "/attachments/" + m[5]
		return reply(http.StatusCreated, req, `{"id":1,"url":"`+link+`"}`), nil
	case http.MethodDelete:
		a.calls = append(a.calls, "delete:"+m[4]+":"+name)
		a.uploads[id] = slices.DeleteFunc(a.uploads[id], func(u Upload) bool { return u.Name == name })
		return reply(http.StatusNoContent, req, ``), nil
	}
	return bad()
}
