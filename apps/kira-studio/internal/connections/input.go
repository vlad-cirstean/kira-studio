package connections

import (
	"math"
	"strings"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// maxNameLength is connectionInputSchema's own name cap — the single source Validate and
// Service.Duplicate's generated "<name> copy" both read, so the two can never drift apart (review
// finding: Duplicate used to append " copy" with no cap at all, which Validate would then have
// rejected outright for any name already close to the limit).
const maxNameLength = 120

// ThrottlePerSecRange mirrors packages/shared/domain/connection.ts's CONNECTION_THROTTLE_RANGE —
// 0 (unlimited) or 0.01-1000 commands/sec.
const (
	throttlePerSecMin = 0.01
	throttlePerSecMax = 1000
)

// fileKinds mirrors connection.ts's FILE_KINDS: fields mode repurposes `database` for an absolute
// local file path.
var fileKinds = map[string]bool{"sqlite": true}

// awsStyleKinds mirrors connection.ts's AWS_STYLE_KINDS: no host/port at all.
var awsStyleKinds = map[string]bool{"sqs": true, "s3": true}

// Input is connectionInputSchema's Go shape. It lives here, not in internal/storage/model, so
// P53's D9 invariant — "no password field anywhere in the model package" — stays literally true.
type Input struct {
	model.ConnectionFields
	Password *string `json:"password"`
}

// Validate ports connectionInputSchema's superRefine plus the field constraints zod enforced by
// shape (P52 §4.2: "an explicit guard at the top of the method, returning E_BAD_REQUEST").
func (in Input) Validate() error {
	name := strings.TrimSpace(in.Name)
	if name == "" || len(name) > maxNameLength {
		return ipcerr.BadRequest("name must be 1-120 characters")
	}
	if !model.ValidConnectionKind(in.Kind) {
		return ipcerr.BadRequest("invalid connection kind")
	}
	if !model.ValidConnectionColor(in.Color) {
		return ipcerr.BadRequest("invalid connection color")
	}
	if !model.ValidConnectionMode(in.Mode) {
		return ipcerr.BadRequest("invalid connection mode")
	}
	if in.Port != nil && (*in.Port < 1 || *in.Port > 65535) {
		return ipcerr.BadRequest("port must be between 1 and 65535")
	}
	if in.Preconnect != nil {
		trimmed := strings.TrimSpace(*in.Preconnect)
		if trimmed == "" || len(*in.Preconnect) > 2000 {
			return ipcerr.BadRequest("preconnect must be 1-2000 characters")
		}
	}
	if math.IsNaN(in.ThrottlePerSec) || math.IsInf(in.ThrottlePerSec, 0) {
		return ipcerr.BadRequest("throttlePerSec must be a finite number")
	}
	if in.ThrottlePerSec != 0 &&
		(in.ThrottlePerSec < throttlePerSecMin || in.ThrottlePerSec > throttlePerSecMax) {
		return ipcerr.BadRequest("throttlePerSec must be 0, or between 0.01 and 1000")
	}

	if in.Mode == "fields" {
		if fileKinds[in.Kind] {
			path := ""
			if in.Database != nil {
				path = strings.TrimSpace(*in.Database)
			}
			if path == "" {
				return ipcerr.BadRequest("A database file is required.")
			}
			if !strings.HasPrefix(path, "/") {
				return ipcerr.BadRequest("The database file must be an absolute path.")
			}
		} else {
			if !awsStyleKinds[in.Kind] && (in.Host == nil || *in.Host == "") {
				return ipcerr.BadRequest("Host is required.")
			}
			if !awsStyleKinds[in.Kind] && in.Port == nil {
				return ipcerr.BadRequest("Port is required.")
			}
		}
	} else {
		if in.URI == nil || strings.TrimSpace(*in.URI) == "" {
			return ipcerr.BadRequest("A connection URI is required.")
		}
	}

	return nil
}

// copySuffix is Service.Duplicate's own generated-name suffix.
const copySuffix = " copy"

// duplicateName is Service.Duplicate's name generator: name + copySuffix, capped at
// maxNameLength — the base name is truncated (never the suffix, so the result always reads as a
// copy) at a rune boundary so it is never invalid UTF-8. Review finding: Duplicate used to append
// copySuffix with no cap at all, which Validate would then reject outright for any name already
// within copySuffix's own length of the limit — Duplicate itself never calls Validate (an
// already-stored name is by definition valid input; a rejection here would be a duplicate that
// silently never happens), so the cap has to be applied at generation time instead.
func duplicateName(name string) string {
	full := name + copySuffix
	if len(full) <= maxNameLength {
		return full
	}
	maxBase := maxNameLength - len(copySuffix)
	if maxBase < 0 {
		maxBase = 0
	}
	cut := maxBase
	for cut > 0 && !utf8.RuneStart(name[cut]) {
		cut--
	}
	return name[:cut] + copySuffix
}
