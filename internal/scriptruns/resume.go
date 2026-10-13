package scriptruns

import (
	"log/slog"
	"strings"

	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/llmprompts"
	"github.com/kirathecat/kira-studio/internal/scripts"
)

// Resume continues the Claude session of a smart run a restart ended, as a new run. The script is
// planned again from its current definition; secret values are never stored, so a script with a
// secret param cannot resume.
func (s *Service) Resume(id string) (Started, error) {
	run, err := s.Runs.Get(id)
	if err != nil {
		return Started{}, err
	}
	notResumable := ipcerr.T(ipcerr.CodeBadRequest, "backend.core.scriptRun.resumeNotResumable.body", map[string]string{"app": s.App})
	if run.Kind != KindSmart || !run.Resumable {
		return Started{}, notResumable
	}
	rec, err := s.Scripts.Get(run.ScriptID)
	if err != nil {
		return Started{}, ipcerr.InternalErr(err)
	}
	if rec == nil {
		return Started{}, ipcerr.T(ipcerr.CodeNotFound, "automations.script.gone.error", nil)
	}
	args, names := resumeArgs(run, *rec)
	p, err := s.plan(args, planOpts{})
	if err != nil {
		return Started{}, err
	}
	names = append(names, p.preview.Missing...)
	if len(names) > 0 {
		return Started{}, ipcerr.T(ipcerr.CodeBadRequest, "backend.core.scriptRun.resumeMissing.body", map[string]string{"names": strings.Join(names, ", ")})
	}
	if p.preview.Blocker != "" {
		return Started{}, ipcerr.BadRequest(p.preview.Blocker)
	}
	if p.dir.Mode == scripts.DirModeWorktree {
		if p, err = s.claimWorktree(p, true); err != nil {
			return Started{}, err
		}
	}
	sessionID, ok, err := s.Runs.TakeResume(id)
	if err != nil || !ok {
		if p.release != nil {
			p.release()
		}
		if err != nil {
			return Started{}, ipcerr.InternalErr(err)
		}
		return Started{}, notResumable
	}
	p.resume, p.resumedFrom = sessionID, id
	p.sent = llmprompts.RunResumeLine.Text(s.llmPrompts(), llmprompts.ResumeVars{App: s.App}) + "\n\n" + p.preview.Suffix
	started, err := s.startSmart(p)
	if err != nil {
		if rerr := s.Runs.RestoreResume(id, sessionID); rerr != nil {
			slog.Warn("scriptruns: restore resume", "scope", "scriptruns", "run", id, "err", rerr)
		}
		if p.release != nil {
			p.release()
		}
	}
	return started, err
}

// resumeArgs rebuilds a run's args from its stored params, and names the secret params whose
// values the row never held.
func resumeArgs(run Run, rec scripts.CustomScript) (RunArgs, []string) {
	args := RunArgs{ScriptID: run.ScriptID, TaskID: run.TaskID, BranchID: run.BranchID, Params: map[string][]string{}}
	var secrets []string
	for _, rp := range run.Params {
		var def *scripts.Param
		for i := range rec.Params {
			if rec.Params[i].Name == rp.Name {
				def = &rec.Params[i]
			}
		}
		switch {
		case def == nil:
		case def.Secret || rp.Value == scripts.SecretMask:
			secrets = append(secrets, rp.Name)
		case rp.Value == "":
		case def.Type == scripts.ParamText:
			args.Params[rp.Name] = []string{rp.Value}
		default:
			args.Params[rp.Name] = strings.Split(rp.Value, "\n")
		}
	}
	return args, secrets
}
