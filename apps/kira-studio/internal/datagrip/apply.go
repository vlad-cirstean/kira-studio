package datagrip

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// CreatorInput mirrors connections.Input's exact shape (D3: this package never imports
// internal/connections, so it cannot reference that type directly — the bridge service adapts
// this struct into the real connections.Input when it wires the real *connections.Service in as
// a Creator, a one-line, field-for-field conversion).
type CreatorInput struct {
	model.ConnectionFields
	Password *string
}

// Creator is Apply's one-method seam onto connections.Service.Create — the same per-consumer
// interface discipline connections.Backend and tree.Backend already follow (D3).
type Creator interface {
	Create(CreatorInput) (model.ConnectionSummary, error)
}

// ReportRow is one row of D9's Report — Error is a D11 reason code on a password-only failure, or
// a Creator error's message when the row's Create call itself failed. JSON tags: this struct
// crosses the bridge verbatim as DataGripService.Import's return value.
type ReportRow struct {
	UUID             string `json:"uuid"`
	Name             string `json:"name"`
	Created          bool   `json:"created"`
	PasswordImported bool   `json:"passwordImported"`
	Error            string `json:"error,omitempty"`
}

// Report is what Apply answers with (D9). It never carries a password.
type Report struct {
	Rows []ReportRow `json:"rows"`
}

// Apply is D9's second step. It re-parses the project (Scan's own Preview is never trusted as
// still current — the files could have changed, and Preview never carried a password anyway),
// then for each selected uuid resolves fields, resolves the password exactly once, and calls
// creator.Create. The plaintext exists only inside this call's stack: it is never written into
// Report, a log line, or any bridge payload (D9). Each row is independent (D8/OQ-5): a failure on
// one row never rolls back another, and the report says per row what happened.
func Apply(projectDir string, selectedUUIDs []string, secretsAvailable bool, creator Creator) (Report, error) {
	project, err := ParseProject(projectDir)
	if err != nil {
		return Report{}, err
	}
	selected := make(map[string]bool, len(selectedUUIDs))
	for _, id := range selectedUUIDs {
		selected[id] = true
	}

	candidates := discoverCandidates(project.CreatedIn)
	var cfg SecurityConfig
	if len(candidates) > 0 {
		cfg = ReadSecurityXML(candidates[0].Dir)
	}

	report := Report{Rows: []ReportRow{}}
	for _, ds := range project.DataSources {
		if !selected[ds.UUID] {
			continue
		}
		report.Rows = append(report.Rows, applyOne(ds, projectDir, candidates, cfg, secretsAvailable, creator))
	}
	return report, nil
}

func applyOne(ds DataSource, projectDir string, candidates []ConfigCandidate, cfg SecurityConfig, secretsAvailable bool, creator Creator) ReportRow {
	name, _ := truncateName(ds.Name)
	row := ReportRow{UUID: ds.UUID, Name: name}

	fields, ok, skipCode, skipDetail := resolveFields(ds, projectDir)
	if !ok {
		row.Error = skipCode
		if skipDetail != "" {
			row.Error = fmt.Sprintf("%s: %s", skipCode, skipDetail)
		}
		return row
	}

	password := fields.Password
	passwordImported := fields.FromURL && password != nil

	if password == nil {
		switch {
		case ds.HasLocal && (ds.SecretStorage == "memory" || ds.SecretStorage == "forget"):
			row.Error = ReasonPasswordNotSaved
		default:
			pw, un, lookupErr := lookupPassword(ds, candidates, cfg)
			if lookupErr == nil {
				password = &pw
				passwordImported = true
				if fields.Username == nil && un != "" {
					fields.Username = &un
				}
			} else if re, isRefusal := lookupErr.(*RefusalError); isRefusal {
				row.Error = re.Code
			} else {
				row.Error = lookupErr.Error()
			}
		}
	}

	// D8: a Linux box with no KIRA_INSECURE_SECRETS set, or a Mac whose Keychain probe failed —
	// this app's own secret storage, not DataGrip's. Every selected row still creates, with no
	// password, rather than the whole import failing.
	if !secretsAvailable {
		password = nil
		passwordImported = false
		row.Error = ReasonSecretStorageUnavailable
	}

	color := kindAccent[fields.Kind]
	if color == "" {
		color = "none"
	}
	in := CreatorInput{
		ConnectionFields: model.ConnectionFields{
			Name: name, Kind: fields.Kind, Color: color, Mode: "fields",
			Host: fields.Host, Port: fields.Port, Database: fields.Database,
			Username: fields.Username, Options: map[string]any{},
		},
		Password: password,
	}
	if _, createErr := creator.Create(in); createErr != nil {
		row.Error = createErr.Error()
		return row
	}
	row.Created = true
	row.PasswordImported = passwordImported
	return row
}

// lookupPassword is D4's ordered credential-store fetch for one data source, run once, at Apply
// time (D9). When every backend in the order fails, a ReasonCredentialStoreUnsupported refusal is
// preferred over a later "not found" — it is the more actionable answer (D1's own remedy text),
// and a store this platform/configuration cannot read at all is a more honest report than "no
// entry", which implies the store was actually checked.
func lookupPassword(ds DataSource, candidates []ConfigCandidate, cfg SecurityConfig) (password, username string, err error) {
	order := LookupOrder(cfg.Provider)
	if len(order) == 0 {
		return "", "", &RefusalError{
			Code:    ReasonPasswordNotSaved,
			Message: "DataGrip is configured not to save passwords",
		}
	}

	var unsupportedErr, lastErr error
	for _, backend := range order {
		var pw, un string
		var berr error
		switch backend {
		case "keychain":
			pw, un, berr = readKeychainPassword(ds.UUID)
		case "kdbx":
			pw, un, berr = lookupKDBX(ds, candidates, cfg)
		}
		if berr == nil {
			return pw, un, nil
		}
		if re, ok := berr.(*RefusalError); ok && re.Code == ReasonCredentialStoreUnsupported && unsupportedErr == nil {
			unsupportedErr = berr
		}
		lastErr = berr
	}
	if unsupportedErr != nil {
		return "", "", unsupportedErr
	}
	return "", "", lastErr
}

func lookupKDBX(ds DataSource, candidates []ConfigCandidate, cfg SecurityConfig) (string, string, error) {
	if len(candidates) == 0 {
		root, _ := jetBrainsConfigRoot()
		return "", "", &RefusalError{
			Code:    ReasonCredentialStoreNotFound,
			Message: fmt.Sprintf("no IntelliJ Platform config directory was found; searched %s", describeSearchedDirs(root)),
		}
	}
	kdbxPath, mainKeyDir := kdbxPathFor(candidates[0], cfg)
	mainKey, err := ReadMainKey(mainKeyDir)
	if err != nil {
		return "", "", err
	}
	return readKDBXPassword(kdbxPath, mainKey, serviceNameForDataSource(ds.UUID))
}

// describeSearchedDirs is D5.4's "the failure message lists the directories actually searched" —
// the single most useful thing a credential-store-not-found error can say.
func describeSearchedDirs(root string) string {
	if root == "" {
		return "(the home directory could not be resolved)"
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return fmt.Sprintf("%s (does not exist)", root)
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			names = append(names, filepath.Join(root, e.Name()))
		}
	}
	if len(names) == 0 {
		return fmt.Sprintf("%s (no subdirectories)", root)
	}
	return strings.Join(names, ", ")
}
