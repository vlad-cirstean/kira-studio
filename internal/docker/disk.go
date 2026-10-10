package docker

import (
	"context"
	"sort"
	"time"

	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/kiratime"
	"github.com/moby/moby/client"
)

// sizeTimeout covers /system/df and size walks, which take seconds to minutes on large hosts.
const sizeTimeout = 2 * time.Minute

// DiskCategory is one /system/df bucket.
type DiskCategory struct {
	Count       int64 `json:"count"`
	Active      int64 `json:"active"`
	Size        int64 `json:"size"`
	Reclaimable int64 `json:"reclaimable"`
}

// VolumeDisk is one volume's measured size; Size is -1 when the engine did not compute it.
type VolumeDisk struct {
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	RefCount int64  `json:"refCount"`
}

// DiskUsage is DiskUsage's wire shape.
type DiskUsage struct {
	TakenAt     string       `json:"takenAt"`
	DurationMs  int64        `json:"durationMs"`
	Total       int64        `json:"total"`
	Images      DiskCategory `json:"images"`
	Containers  DiskCategory `json:"containers"`
	Volumes     DiskCategory `json:"volumes"`
	BuildCache  DiskCategory `json:"buildCache"`
	VolumeSizes []VolumeDisk `json:"volumeSizes"`
}

// ContainerSize is ContainerSize's wire shape.
type ContainerSize struct {
	SizeRw     int64  `json:"sizeRw"`
	SizeRootFs int64  `json:"sizeRootFs"`
	TakenAt    string `json:"takenAt"`
	DurationMs int64  `json:"durationMs"`
}

// diskUsage measures the whole engine. Concurrent identical calls share one df: some engines
// reject a second concurrent one.
func (m *Manager) diskUsage() (DiskUsage, error) {
	_, ep, _ := m.client()
	v, err, _ := m.flight.Do("df|"+ep.Host+"|"+ep.Context, func() (any, error) {
		return m.measureDisk(context.Background())
	})
	if err != nil {
		return DiskUsage{}, err
	}
	return v.(DiskUsage), nil
}

func (m *Manager) measureDisk(ctx context.Context) (DiskUsage, error) {
	var out DiskUsage
	start := time.Now()
	err := m.call(ctx, sizeTimeout, func(ctx context.Context, cli *client.Client) error {
		r, err := cli.DiskUsage(ctx, client.DiskUsageOptions{Containers: true, Images: true, BuildCache: true, Volumes: true, Verbose: true})
		if err != nil {
			return err
		}
		out.Images = DiskCategory{r.Images.TotalCount, r.Images.ActiveCount, r.Images.TotalSize, r.Images.Reclaimable}
		out.Containers = DiskCategory{r.Containers.TotalCount, r.Containers.ActiveCount, r.Containers.TotalSize, r.Containers.Reclaimable}
		out.Volumes = DiskCategory{r.Volumes.TotalCount, r.Volumes.ActiveCount, r.Volumes.TotalSize, r.Volumes.Reclaimable}
		out.BuildCache = DiskCategory{r.BuildCache.TotalCount, r.BuildCache.ActiveCount, r.BuildCache.TotalSize, r.BuildCache.Reclaimable}
		out.VolumeSizes = make([]VolumeDisk, 0, len(r.Volumes.Items))
		for _, v := range r.Volumes.Items {
			vd := VolumeDisk{Name: v.Name, Size: -1}
			if v.UsageData != nil {
				vd.Size, vd.RefCount = v.UsageData.Size, v.UsageData.RefCount
			}
			out.VolumeSizes = append(out.VolumeSizes, vd)
		}
		return nil
	})
	if err != nil {
		return DiskUsage{}, err
	}
	sort.Slice(out.VolumeSizes, func(i, j int) bool {
		a, b := out.VolumeSizes[i], out.VolumeSizes[j]
		if a.Size != b.Size {
			return a.Size > b.Size
		}
		return a.Name < b.Name
	})
	out.Total = out.Images.Size + out.Containers.Size + out.Volumes.Size + out.BuildCache.Size
	out.DurationMs = time.Since(start).Milliseconds()
	out.TakenAt = kiratime.NowISO()
	return out, nil
}

// containerSize measures one container's writable layer and total size.
func (m *Manager) containerSize(id string) (ContainerSize, error) {
	if id == "" {
		return ContainerSize{}, ipcerr.New("E_INVALID", "id is required")
	}
	_, ep, _ := m.client()
	v, err, _ := m.flight.Do("size|"+ep.Host+"|"+ep.Context+"|"+id, func() (any, error) {
		return m.measureContainer(context.Background(), id)
	})
	if err != nil {
		return ContainerSize{}, err
	}
	return v.(ContainerSize), nil
}

func (m *Manager) measureContainer(ctx context.Context, id string) (ContainerSize, error) {
	var out ContainerSize
	start := time.Now()
	err := m.call(ctx, sizeTimeout, func(ctx context.Context, cli *client.Client) error {
		r, err := cli.ContainerInspect(ctx, id, client.ContainerInspectOptions{Size: true})
		if err != nil {
			return err
		}
		if r.Container.SizeRw != nil {
			out.SizeRw = *r.Container.SizeRw
		}
		if r.Container.SizeRootFs != nil {
			out.SizeRootFs = *r.Container.SizeRootFs
		}
		return nil
	})
	if err != nil {
		return ContainerSize{}, err
	}
	out.DurationMs = time.Since(start).Milliseconds()
	out.TakenAt = kiratime.NowISO()
	return out, nil
}
