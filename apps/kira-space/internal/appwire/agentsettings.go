package appwire

import (
	"fmt"
	"os"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/harness"
	"github.com/kirathecat/kira-studio/internal/harness/providers"
	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

// memoryModelFrom reads memory.models through the app's open settings handle; "" means the
// provider's catalog default.
func memoryModelFrom(r *repos.SettingsRepo) memory.ModelSource {
	return func(provider string) (string, error) {
		s, err := r.GetAll()
		if err != nil {
			return "", err
		}
		return s.Memory.Models[provider], nil
	}
}

// agentProviderFrom reads agent.provider through the app's open settings handle.
func agentProviderFrom(r *repos.SettingsRepo) func() (string, error) {
	return func() (string, error) {
		s, err := r.GetAll()
		if err != nil {
			return "", err
		}
		return s.Agent.Provider, nil
	}
}

// readSettingsAt opens kira.db for one read, so a change in the app applies to the next call. A
// missing file reads as the defaults and is never created.
func readSettingsAt(dbPath string) (model.Settings, error) {
	if _, err := os.Stat(dbPath); err != nil {
		if os.IsNotExist(err) {
			return model.DefaultSettings(), nil
		}
		return model.Settings{}, err
	}
	db, err := sqlitex.Open(dbPath)
	if err != nil {
		return model.Settings{}, err
	}
	defer db.Close()
	s, err := (&repos.SettingsRepo{DB: db}).GetAll()
	if err != nil {
		return model.Settings{}, fmt.Errorf("read settings: %w", err)
	}
	return s, nil
}

// memoryModelAt serves the memory-mcp and memory-ingest processes.
func memoryModelAt(dbPath string) memory.ModelSource {
	return func(provider string) (string, error) {
		s, err := readSettingsAt(dbPath)
		if err != nil {
			return "", err
		}
		return s.Memory.Models[provider], nil
	}
}

// agentProviderAt serves the memory-mcp and memory-ingest processes.
func agentProviderAt(dbPath string) func() (string, error) {
	return func() (string, error) {
		s, err := readSettingsAt(dbPath)
		if err != nil {
			return "", err
		}
		return s.Agent.Provider, nil
	}
}

// agentSelectorAt serves the memory-mcp and memory-ingest processes.
func agentSelectorAt(dbPath string) harness.Selector {
	return harness.Selector{Registry: providers.New(), ID: agentProviderAt(dbPath)}
}

// agentSelector resolves the active provider from the app's settings.
func agentSelector(registry *harness.Registry, r *repos.SettingsRepo) harness.Selector {
	return harness.Selector{Registry: registry, ID: agentProviderFrom(r)}
}
