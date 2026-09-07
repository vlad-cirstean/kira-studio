package datagrip

import "os"

// PasswordOutlook is D9's four-value classification a Scan can make with file reads alone, before
// any credential store is actually opened.
type PasswordOutlook string

const (
	// OutlookWillAttempt means Apply will try to fetch and decrypt a password for this row.
	OutlookWillAttempt PasswordOutlook = "will-attempt"
	// OutlookNotSaved means DataGrip itself never wrote a password for this row (secret-storage
	// memory/forget, or the resolved provider is MEMORY_ONLY/DO_NOT_STORE) — not a failure.
	OutlookNotSaved PasswordOutlook = "not-saved"
	// OutlookFromURL means D7's configured-by-url exception already supplied the password —
	// no credential store will be touched for this row at all.
	OutlookFromURL PasswordOutlook = "from-url"
	// OutlookStoreUnsupported means neither backend Apply would try is reachable on this
	// platform/configuration (D1) — file reads alone are enough to know this in advance.
	OutlookStoreUnsupported PasswordOutlook = "store-unsupported"
)

// PreviewRow is one line of D10's review dialog.
type PreviewRow struct {
	UUID       string
	Name       string
	Importable bool

	// Populated only when Importable.
	Kind            string
	Host            *string
	Port            *int
	Database        *string
	Username        *string
	PasswordOutlook PasswordOutlook

	// Populated only when !Importable — one of D11's four "no row at all" reasons.
	SkipReason string
	SkipDetail string

	// Warnings that do not block import (name-truncated, ssh-tunnel-dropped).
	Warnings []string
}

// Preview is one Scan's answer — D9: file reads only, no credential store touched (F11: touching
// the macOS Keychain here would double the authorization panels a real import shows).
type Preview struct {
	ProjectDir string
	Rows       []PreviewRow
}

// Scan parses projectDir's two data-source files, maps engines and fields, locates the IntelliJ
// Platform config directory, and reads security.xml — all file reads, no keychain and no KDBX
// decrypt (D9). configDirs (possibly empty) are exported alongside Preview by ScanResult, so Apply
// can be given the exact same candidate list rather than re-discovering it (a second enumeration
// could observe a different filesystem state, however unlikely, between the two calls).
func Scan(projectDir string) (*Preview, error) {
	project, err := ParseProject(projectDir)
	if err != nil {
		return nil, err
	}

	candidates := discoverCandidates(project.CreatedIn)
	var cfg SecurityConfig
	if len(candidates) > 0 {
		cfg = ReadSecurityXML(candidates[0].Dir)
	}

	preview := &Preview{ProjectDir: projectDir, Rows: []PreviewRow{}}
	for _, ds := range project.DataSources {
		preview.Rows = append(preview.Rows, previewRowFor(ds, projectDir, candidates, cfg))
	}
	return preview, nil
}

func discoverCandidates(createdIn string) []ConfigCandidate {
	root, err := jetBrainsConfigRoot()
	if err != nil {
		return nil
	}
	candidates, _ := DiscoverConfigDirs(root, createdIn)
	return candidates
}

func previewRowFor(ds DataSource, projectDir string, candidates []ConfigCandidate, cfg SecurityConfig) PreviewRow {
	name, truncated := truncateName(ds.Name)
	row := PreviewRow{UUID: ds.UUID, Name: name}
	if truncated {
		row.Warnings = append(row.Warnings, WarnNameTruncated)
	}
	if ds.SSHEnabled {
		row.Warnings = append(row.Warnings, WarnSSHTunnelDropped)
	}

	fields, ok, skipCode, skipDetail := resolveFields(ds, projectDir)
	if !ok {
		row.SkipReason = skipCode
		row.SkipDetail = skipDetail
		return row
	}

	row.Importable = true
	row.Kind = fields.Kind
	row.Host = fields.Host
	row.Port = fields.Port
	row.Database = fields.Database
	row.Username = fields.Username
	row.PasswordOutlook = outlookFor(ds, fields, candidates, cfg)
	return row
}

// outlookFor is D9's classification — file reads and in-memory facts only.
func outlookFor(ds DataSource, fields ResolvedFields, candidates []ConfigCandidate, cfg SecurityConfig) PasswordOutlook {
	if fields.FromURL {
		return OutlookFromURL
	}
	if ds.HasLocal && (ds.SecretStorage == "memory" || ds.SecretStorage == "forget") {
		return OutlookNotSaved
	}
	if cfg.Provider == "MEMORY_ONLY" || cfg.Provider == "DO_NOT_STORE" {
		return OutlookNotSaved
	}

	order := LookupOrder(cfg.Provider)
	if len(order) == 0 {
		return OutlookNotSaved
	}
	for _, backend := range order {
		switch backend {
		case "keychain":
			if keychainSupported {
				return OutlookWillAttempt
			}
		case "kdbx":
			if len(candidates) == 0 {
				continue
			}
			kdbxPath, _ := kdbxPathFor(candidates[0], cfg)
			if _, err := os.Stat(kdbxPath); err == nil {
				return OutlookWillAttempt
			}
		}
	}
	return OutlookStoreUnsupported
}
