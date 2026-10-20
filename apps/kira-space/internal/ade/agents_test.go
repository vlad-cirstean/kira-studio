package ade

import (
	"github.com/kirathecat/kira-studio/internal/harness"
	"github.com/kirathecat/kira-studio/internal/harness/providers"
)

var testAgents = harness.Selector{Registry: providers.New()}
