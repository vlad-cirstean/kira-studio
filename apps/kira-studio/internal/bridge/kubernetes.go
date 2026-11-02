package bridge

import "github.com/kirathecat/kira-studio/apps/kira-studio/internal/kubernetes"

// KubernetesService is Kira Studio's own binding-name shim over kubernetes.BoundService, same
// reason as DockerService.
type KubernetesService struct {
	*kubernetes.BoundService
}
