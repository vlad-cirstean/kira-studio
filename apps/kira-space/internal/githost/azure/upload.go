package azure

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
)

const (
	uploadTimeout = 60 * time.Second
	// maxUploadReply bounds the response body read; it is never echoed.
	maxUploadReply = 64 << 10

	reasonAttachSignIn = "Attaching files needs an az login sign-in. A PAT sign-in (az devops login) can post text only."
)

// uploader sends attachment bytes straight to Azure DevOps: `az devops invoke` cannot send a binary
// body. The bearer token is passed per call, sent only to dev.azure.com, and never stored or logged.
type uploader struct{ client *http.Client }

func newUploader(rt http.RoundTripper) *uploader {
	if rt == nil {
		rt = http.DefaultTransport
	}
	return &uploader{client: &http.Client{
		Transport: rt,
		Timeout:   uploadTimeout,
		// The token must never follow a redirect to another host.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

func attachmentURL(org, project, repo string, number int, name string) string {
	return orgURL(org) + "/" + url.PathEscape(project) + "/_apis/git/repositories/" + url.PathEscape(repo) +
		"/pullRequests/" + strconv.Itoa(number) + "/attachments/" + url.PathEscape(name) + "?api-version=" + apiVersion
}

// uniqueName prefixes name so two posts never collide on Azure's per-pull-request name key.
func uniqueName(name string) (string, error) {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]) + "-" + name, nil
}

// upload sends a and returns the link Azure DevOps serves it at, and the name it was stored under.
func (u *uploader) upload(ctx context.Context, token, org, project, repo string, number int, a githost.Attachment) (link, stored string, st githost.Status) {
	site := orgURL(org)
	stored, err := uniqueName(a.Name)
	if err != nil {
		return "", "", status(site, githost.KindForbidden, "could not name the attachment")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, attachmentURL(org, project, repo, number, stored), bytes.NewReader(a.Data))
	if err != nil {
		return "", "", status(site, githost.KindForbidden, "could not build the upload request")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Accept", "application/json")
	resp, err := u.client.Do(req)
	if err != nil {
		return "", "", transportStatus(site, ctx, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, maxUploadReply))
	switch resp.StatusCode {
	case http.StatusOK, http.StatusCreated, http.StatusAccepted:
		var out struct {
			URL string `json:"url"`
		}
		if json.Unmarshal(body, &out) != nil || !azureHTTPS(out.URL) {
			return "", "", status(site, githost.KindForbidden, "Azure DevOps returned an unusable attachment link")
		}
		return out.URL, stored, status(site, githost.KindOK, "")
	case http.StatusUnauthorized:
		return "", "", status(site, githost.KindUnauthenticated, signInReason(site))
	case http.StatusForbidden:
		return "", "", status(site, githost.KindForbidden, reasonDenied)
	case http.StatusNotFound:
		return "", "", gone(site)
	case http.StatusRequestEntityTooLarge:
		return "", "", status(site, githost.KindForbidden, "Azure DevOps refused the file as too large")
	case http.StatusTooManyRequests:
		s := status(site, githost.KindForbidden, reasonThrottled)
		s.RateLimited = true
		if secs, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil && secs > 0 && secs < 3600 {
			s.ResetAt = time.Now().Add(time.Duration(secs) * time.Second)
		}
		return "", "", s
	}
	return "", "", status(site, githost.KindForbidden, "Azure DevOps answered HTTP "+strconv.Itoa(resp.StatusCode))
}

// remove deletes an uploaded attachment, best effort: a failed post leaves nothing dangling.
func (u *uploader) remove(ctx context.Context, token, org, project, repo string, number int, stored string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, attachmentURL(org, project, repo, number, stored), nil)
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := u.client.Do(req)
	if err != nil {
		return
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, maxUploadReply))
	resp.Body.Close()
}

func transportStatus(site string, ctx context.Context, err error) githost.Status {
	var ne interface{ Timeout() bool }
	switch {
	case ctx.Err() != nil:
		return status(site, githost.KindNotFound, "cancelled")
	case errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &ne) && ne.Timeout()):
		return status(site, githost.KindNotFound, "Azure DevOps did not answer the upload in time")
	}
	return status(site, githost.KindNotFound, "could not reach Azure DevOps")
}

// azureHTTPS reports whether raw is an https link on an Azure DevOps host.
func azureHTTPS(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil {
		return false
	}
	h := strings.ToLower(u.Hostname())
	return h == Host || strings.HasSuffix(h, ".visualstudio.com")
}
