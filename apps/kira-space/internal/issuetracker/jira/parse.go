package jira

import (
	"encoding/json"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/issuetracker"
)

const keyPattern = `[A-Z][A-Z0-9]+-\d+`

var (
	keyRe     = regexp.MustCompile(`^` + keyPattern + `$`)
	pathKeyRe = regexp.MustCompile(`/(?:browse|issues)/(` + keyPattern + `)(?:[/?#]|$)`)
)

// parseRef accepts a bare key (PROJ-12), /browse/KEY, /jira/.../issues/KEY and any URL with
// selectedIssue=KEY. The host is not checked here; Issue compares it with the signed-in site.
func parseRef(raw string) (issuetracker.Ref, bool) {
	raw = strings.TrimSpace(raw)
	if keyRe.MatchString(raw) {
		return issuetracker.Ref{Provider: ProviderID, Key: raw}, true
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return issuetracker.Ref{}, false
	}
	key := u.Query().Get("selectedIssue")
	if !keyRe.MatchString(key) {
		m := pathKeyRe.FindStringSubmatch(u.Path)
		if m == nil {
			return issuetracker.Ref{}, false
		}
		key = m[1]
	}
	return issuetracker.Ref{Provider: ProviderID, Key: key, URL: raw, Site: strings.ToLower(u.Host)}, true
}

// issueFields is the part of `acli jira workitem view --json` this provider reads.
type issueFields struct {
	Key    string                     `json:"key"`
	Fields map[string]json.RawMessage `json:"fields"`
}

type issueParsed struct {
	key, title, status, category string
	fields                       map[string]json.RawMessage
}

func parseIssue(out []byte) (issueParsed, bool) {
	var f issueFields
	if err := json.Unmarshal(out, &f); err != nil || f.Key == "" || f.Fields == nil {
		return issueParsed{}, false
	}
	p := issueParsed{key: f.Key, fields: f.Fields}
	_ = json.Unmarshal(f.Fields["summary"], &p.title)
	var st struct {
		Name           string `json:"name"`
		StatusCategory struct {
			Key string `json:"key"`
		} `json:"statusCategory"`
	}
	_ = json.Unmarshal(f.Fields["status"], &st)
	p.status, p.category = st.Name, st.StatusCategory.Key
	return p, true
}

// findDevField returns the id of the Development custom field and its parsed summary. The field holds
// the summary only (count, state, providers): Jira lists the pull request rows through an internal
// endpoint acli does not expose.
func findDevField(fields map[string]json.RawMessage) (id string, sum issuetracker.ChangeRequestSummary, ok bool) {
	ids := make([]string, 0, len(fields))
	for k := range fields {
		if strings.HasPrefix(k, "customfield_") {
			ids = append(ids, k)
		}
	}
	sort.Strings(ids)
	for _, k := range ids {
		if s, found := parseDevSummary(fields[k]); found {
			return k, s, true
		}
	}
	return "", issuetracker.ChangeRequestSummary{}, false
}

// parseDevSummary reads the Development field in either form Jira serves: the string
// `{pullrequest={...}, json={"cachedValue":...}}` or an object holding cachedValue.summary.pullrequest.
func parseDevSummary(raw json.RawMessage) (issuetracker.ChangeRequestSummary, bool) {
	if len(raw) == 0 {
		return issuetracker.ChangeRequestSummary{}, false
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return parseDevString(s)
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil {
		return issuetracker.ChangeRequestSummary{}, false
	}
	return parseDevObject(obj)
}

func parseDevObject(obj map[string]json.RawMessage) (issuetracker.ChangeRequestSummary, bool) {
	if pr, ok := obj["pullrequest"]; ok {
		if sum, ok := summaryFromPullRequest(pr); ok {
			return sum, true
		}
	}
	for _, k := range []string{"cachedValue", "summary", "json"} {
		if inner := asObject(obj[k]); inner != nil {
			if sum, ok := parseDevObject(inner); ok {
				return sum, true
			}
		}
	}
	return issuetracker.ChangeRequestSummary{}, false
}

// asObject decodes raw as a JSON object, or as a string holding one; nil when it is neither.
func asObject(raw json.RawMessage) map[string]json.RawMessage {
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) == nil {
		return obj
	}
	var s string
	if json.Unmarshal(raw, &s) == nil && json.Unmarshal([]byte(s), &obj) == nil {
		return obj
	}
	return nil
}

func summaryFromPullRequest(raw json.RawMessage) (issuetracker.ChangeRequestSummary, bool) {
	var pr struct {
		Overall *struct {
			Count int    `json:"count"`
			State string `json:"state"`
		} `json:"overall"`
		ByInstanceType map[string]struct {
			Name string `json:"name"`
		} `json:"byInstanceType"`
	}
	if json.Unmarshal(raw, &pr) != nil || pr.Overall == nil {
		return issuetracker.ChangeRequestSummary{}, false
	}
	sum := issuetracker.ChangeRequestSummary{
		Known: true, Count: pr.Overall.Count, State: strings.ToLower(pr.Overall.State), Providers: []string{},
	}
	for key, v := range pr.ByInstanceType {
		name := v.Name
		if name == "" {
			name = key
		}
		sum.Providers = append(sum.Providers, name)
	}
	sort.Strings(sum.Providers)
	return sum, true
}

var (
	devStateCountRe = regexp.MustCompile(`pullrequest=\{[^}]*?stateCount=(\d+)`)
	devStateRe      = regexp.MustCompile(`pullrequest=\{[^}]*?\bstate=(\w+)`)
)

func parseDevString(s string) (issuetracker.ChangeRequestSummary, bool) {
	if !strings.Contains(s, "pullrequest") {
		return issuetracker.ChangeRequestSummary{}, false
	}
	if i := strings.Index(s, "json="); i >= 0 {
		body := strings.TrimSuffix(strings.TrimSpace(s[i+len("json="):]), "}")
		var obj map[string]json.RawMessage
		if json.Unmarshal([]byte(body), &obj) == nil {
			if sum, ok := parseDevObject(obj); ok {
				return sum, true
			}
		}
	}
	// The json part is missing or cut off: fall back to the short form, whose stateCount counts the
	// pull requests in the overall state.
	m := devStateCountRe.FindStringSubmatch(s)
	if m == nil {
		return issuetracker.ChangeRequestSummary{}, false
	}
	n, _ := strconv.Atoi(m[1])
	sum := issuetracker.ChangeRequestSummary{Known: true, Count: n, Providers: []string{}}
	if sm := devStateRe.FindStringSubmatch(s); sm != nil {
		sum.State = strings.ToLower(sm[1])
	}
	return sum, true
}
