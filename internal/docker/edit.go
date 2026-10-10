package docker

import (
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"maps"
	"net/netip"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/mount"
	"github.com/moby/moby/client"
)

const (
	labelSwarmTask = "com.docker.swarm.task.id"

	managedSwarm      = "swarm"
	managedKubernetes = "kubernetes"

	minMemory = 6 << 20
)

var (
	nameRe   = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]+$`)
	cpusetRe = regexp.MustCompile(`^\d+(-\d+)?(,\d+(-\d+)?)*$`)
)

// Resources is the in-place editable limit set. Zero means "no limit" except where noted.
type Resources struct {
	CPUShares         int64  `json:"cpuShares"`
	NanoCPUs          int64  `json:"nanoCpus"`
	CPUQuota          int64  `json:"cpuQuota"`
	CPUPeriod         int64  `json:"cpuPeriod"`
	CpusetCpus        string `json:"cpusetCpus"`
	CpusetMems        string `json:"cpusetMems"`
	Memory            int64  `json:"memory"`
	MemorySwap        int64  `json:"memorySwap"` // -1 unlimited, 0 engine default (2x memory)
	MemoryReservation int64  `json:"memoryReservation"`
	BlkioWeight       int    `json:"blkioWeight"`
	PidsLimit         int64  `json:"pidsLimit"` // 0 unlimited
}

// RestartPolicy is a container's restart policy.
type RestartPolicy struct {
	Name       string `json:"name"` // no | always | on-failure | unless-stopped
	MaxRetries int    `json:"maxRetries"`
}

// EditNetwork is one network attachment.
type EditNetwork struct {
	Name    string   `json:"name"`
	Aliases []string `json:"aliases"` // user aliases only; short-ID alias filtered out
	IPv4    string   `json:"ipv4"`    // static IPAM address, preserved, read-only in the UI
	IPv6    string   `json:"ipv6"`
}

// InPlaceSpec is everything the engine can change on a live container.
type InPlaceSpec struct {
	Name      string        `json:"name"`
	Resources Resources     `json:"resources"`
	Restart   RestartPolicy `json:"restart"`
	Networks  []EditNetwork `json:"networks"` // sorted by name
}

// PortBinding is one published port.
type PortBinding struct {
	ContainerPort int    `json:"containerPort"`
	Proto         string `json:"proto"` // tcp | udp | sctp
	HostIP        string `json:"hostIp"`
	HostPort      string `json:"hostPort"` // "" = engine-assigned
}

// EditMount is one bind or named-volume mount row.
type EditMount struct {
	Key      string `json:"key"`  // stable id of an existing mount, "" for a new row
	Type     string `json:"type"` // bind | volume
	Source   string `json:"source"`
	Target   string `json:"target"`
	ReadOnly bool   `json:"readOnly"`
}

// RecreateSpec is everything that needs a new container.
type RecreateSpec struct {
	Image      string            `json:"image"`
	Cmd        []string          `json:"cmd"`
	Entrypoint []string          `json:"entrypoint"`
	Env        []string          `json:"env"`
	Labels     map[string]string `json:"labels"`
	User       string            `json:"user"`
	Hostname   string            `json:"hostname"` // "" = engine default (short ID)
	Ports      []PortBinding     `json:"ports"`
	Mounts     []EditMount       `json:"mounts"` // bind and named-volume mounts only
	CapAdd     []string          `json:"capAdd"`
	CapDrop    []string          `json:"capDrop"`
}

// AnonVolume is an unnamed volume a recreate detaches.
type AnonVolume struct {
	Name        string `json:"name"`
	Destination string `json:"destination"`
}

// EditSpec is ContainerEditSpec's wire shape: the current editable config plus what the UI needs
// for notices and the recreate confirmation.
type EditSpec struct {
	ID               string       `json:"id"`
	State            string       `json:"state"`
	BaseHash         string       `json:"baseHash"` // sha256 of the canonical JSON of InPlace+Recreate
	InPlace          InPlaceSpec  `json:"inPlace"`
	Recreate         RecreateSpec `json:"recreate"`
	NetworkMode      string       `json:"networkMode"` // bridge | host | none | container:<id> | <network>
	Managed          string       `json:"managed"`     // "" | swarm | kubernetes: editor read-only
	AutoRemove       bool         `json:"autoRemove"`  // recreate refused
	Origin           string       `json:"origin"`
	OriginName       string       `json:"originName"`
	AnonymousVolumes []AnonVolume `json:"anonymousVolumes"`
	Dependents       []string     `json:"dependents"` // container names using network_mode container:<this>
	Preserved        []string     `json:"preserved"`  // non-editable settings kept on recreate, as short labels
}

// UpdateArgs is UpdateContainer's wire shape.
type UpdateArgs struct {
	ID       string      `json:"id"`
	BaseHash string      `json:"baseHash"`
	Spec     InPlaceSpec `json:"spec"`
}

// UpdateResult reports what UpdateContainer applied.
type UpdateResult struct {
	Applied  []string `json:"applied"`  // step labels in order: "rename", "resources", "restart", "network:<n>"
	Warnings []string `json:"warnings"` // engine warnings, verbatim
}

// RecreateArgs is RecreateContainer's wire shape.
type RecreateArgs struct {
	ID       string       `json:"id"`
	BaseHash string       `json:"baseHash"`
	InPlace  InPlaceSpec  `json:"inPlace"`
	Recreate RecreateSpec `json:"recreate"`
}

// RecreateResult reports the replacement container.
type RecreateResult struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	OldID    string   `json:"oldId"`
	Warnings []string `json:"warnings"`
}

func mustJSON(v any) json.RawMessage {
	raw, _ := json.Marshal(v)
	return raw
}

func shortID(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

func invalid(field, msg string) error {
	e := ipcerr.New("E_INVALID", msg)
	e.Details, _ = json.Marshal(map[string]string{"field": field})
	return e
}

func (s EditSpec) readOnlyErr() error {
	if s.Managed != "" {
		return ipcerr.New("E_INVALID", "container is managed by "+s.Managed+"; edit the workload instead")
	}
	return nil
}

// parseBind splits a "src:dst[:opts]" bind string.
func parseBind(b string) (src, dst string, ro bool) {
	parts := strings.Split(b, ":")
	if len(parts) < 2 {
		return "", b, false
	}
	src, dst = parts[0], parts[1]
	if len(parts) > 2 {
		for _, o := range strings.Split(parts[2], ",") {
			if o == "ro" {
				ro = true
			}
		}
	}
	return src, dst, ro
}

func bindType(src string) string {
	if strings.ContainsAny(src, `/\`) || strings.HasPrefix(src, ".") {
		return "bind"
	}
	return "volume"
}

// editRows lists the editable mount rows of an inspect and which HostConfig entries they came from.
func editRows(hc *container.HostConfig) []EditMount {
	rows := []EditMount{}
	for i, b := range hc.Binds {
		src, dst, ro := parseBind(b)
		rows = append(rows, EditMount{Key: fmt.Sprintf("bind:%d", i), Type: bindType(src), Source: src, Target: dst, ReadOnly: ro})
	}
	for i, mt := range hc.Mounts {
		if (mt.Type == mount.TypeBind || mt.Type == mount.TypeVolume) && mt.Source != "" {
			rows = append(rows, EditMount{Key: fmt.Sprintf("mount:%d", i), Type: string(mt.Type), Source: mt.Source, Target: mt.Target, ReadOnly: mt.ReadOnly})
		}
	}
	return rows
}

func userAliases(aliases []string, r container.InspectResponse) []string {
	out := []string{}
	name := strings.TrimPrefix(r.Name, "/")
	for _, a := range aliases {
		if a == shortID(r.ID) || a == name {
			continue
		}
		out = append(out, a)
	}
	return out
}

func networkMode(hc *container.HostConfig) string {
	mode := string(hc.NetworkMode)
	if mode == "" || mode == "default" {
		return "bridge"
	}
	return mode
}

// specFromInspect builds the editable view of an inspect; Dependents is filled by the caller.
func specFromInspect(r container.InspectResponse) EditSpec {
	name := strings.TrimPrefix(r.Name, "/")
	s := EditSpec{
		ID: r.ID, AnonymousVolumes: []AnonVolume{}, Dependents: []string{}, Preserved: []string{},
		InPlace: InPlaceSpec{Name: name, Networks: []EditNetwork{}, Restart: RestartPolicy{Name: "no"}},
		Recreate: RecreateSpec{
			Cmd: []string{}, Entrypoint: []string{}, Env: []string{}, Labels: map[string]string{},
			Ports: []PortBinding{}, Mounts: []EditMount{}, CapAdd: []string{}, CapDrop: []string{},
		},
		NetworkMode: "bridge",
	}
	if r.State != nil {
		s.State = string(r.State.Status)
	}
	if r.Config != nil {
		specConfig(&s, r)
	}
	if r.HostConfig != nil {
		specHost(&s, r)
	}
	specNetworks(&s, r)
	specAnonymous(&s, r)
	s.BaseHash = hashSpec(s.InPlace, s.Recreate)
	return s
}

func specConfig(s *EditSpec, r container.InspectResponse) {
	cfg, rc := r.Config, &s.Recreate
	rc.Image, rc.User = cfg.Image, cfg.User
	rc.Cmd, rc.Entrypoint, rc.Env = nonNil(cfg.Cmd), nonNil(cfg.Entrypoint), nonNil(cfg.Env)
	maps.Copy(rc.Labels, cfg.Labels)
	if cfg.Hostname != shortID(r.ID) {
		rc.Hostname = cfg.Hostname
	}
	s.Origin, s.OriginName = originOf(cfg.Labels, s.InPlace.Name)
	switch {
	case cfg.Labels[labelSwarmTask] != "":
		s.Managed = managedSwarm
	case cfg.Labels[labelPodName] != "":
		s.Managed = managedKubernetes
	}
}

func specHost(s *EditSpec, r container.InspectResponse) {
	hc := r.HostConfig
	s.NetworkMode = networkMode(hc)
	s.AutoRemove = hc.AutoRemove
	res := hc.Resources
	s.InPlace.Resources = Resources{
		CPUShares: res.CPUShares, NanoCPUs: res.NanoCPUs, CPUQuota: res.CPUQuota, CPUPeriod: res.CPUPeriod,
		CpusetCpus: res.CpusetCpus, CpusetMems: res.CpusetMems, Memory: res.Memory, MemorySwap: res.MemorySwap,
		MemoryReservation: res.MemoryReservation, BlkioWeight: int(res.BlkioWeight),
	}
	if res.PidsLimit != nil && *res.PidsLimit > 0 {
		s.InPlace.Resources.PidsLimit = *res.PidsLimit
	}
	if n := string(hc.RestartPolicy.Name); n != "" {
		s.InPlace.Restart = RestartPolicy{Name: n, MaxRetries: hc.RestartPolicy.MaximumRetryCount}
	}
	s.Recreate.CapAdd, s.Recreate.CapDrop = nonNil(hc.CapAdd), nonNil(hc.CapDrop)
	for p, bs := range hc.PortBindings {
		for _, b := range bs {
			s.Recreate.Ports = append(s.Recreate.Ports, PortBinding{ContainerPort: int(p.Num()), Proto: string(p.Proto()), HostIP: addrString(b.HostIP), HostPort: b.HostPort})
		}
	}
	sort.Slice(s.Recreate.Ports, func(i, j int) bool {
		a, b := s.Recreate.Ports[i], s.Recreate.Ports[j]
		return cmp.Or(cmp.Compare(a.ContainerPort, b.ContainerPort), cmp.Compare(a.Proto, b.Proto), cmp.Compare(a.HostPort, b.HostPort)) < 0
	})
	s.Recreate.Mounts = editRows(hc)
	s.Preserved = preservedOf(r)
}

func specNetworks(s *EditSpec, r container.InspectResponse) {
	if r.NetworkSettings == nil {
		return
	}
	for _, n := range sortedKeys(r.NetworkSettings.Networks) {
		en := EditNetwork{Name: n, Aliases: []string{}}
		if e := r.NetworkSettings.Networks[n]; e != nil {
			en.Aliases = userAliases(e.Aliases, r)
			if e.IPAMConfig != nil {
				en.IPv4, en.IPv6 = addrString(e.IPAMConfig.IPv4Address), addrString(e.IPAMConfig.IPv6Address)
			}
		}
		s.InPlace.Networks = append(s.InPlace.Networks, en)
	}
}

func specAnonymous(s *EditSpec, r container.InspectResponse) {
	targets := map[string]bool{}
	for _, row := range s.Recreate.Mounts {
		targets[row.Target] = true
	}
	for _, mp := range r.Mounts {
		if mp.Type == mount.TypeVolume && mp.Name != "" && !targets[mp.Destination] {
			s.AnonymousVolumes = append(s.AnonymousVolumes, AnonVolume{Name: mp.Name, Destination: mp.Destination})
		}
	}
	sort.Slice(s.AnonymousVolumes, func(i, j int) bool { return s.AnonymousVolumes[i].Destination < s.AnonymousVolumes[j].Destination })
}

func hashSpec(in InPlaceSpec, rc RecreateSpec) string {
	raw, _ := json.Marshal(struct {
		InPlace  InPlaceSpec
		Recreate RecreateSpec
	}{in, rc})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// preservedOf lists settings a recreate keeps but the editor does not expose.
func preservedOf(r container.InspectResponse) []string {
	out := []string{}
	hc, cfg := r.HostConfig, r.Config
	if hc.Privileged {
		out = append(out, "privileged")
	}
	if len(hc.Tmpfs) > 0 {
		out = append(out, "tmpfs "+strings.Join(sortedKeys(hc.Tmpfs), ", "))
	}
	if n := len(hc.Devices); n > 0 {
		out = append(out, fmt.Sprintf("devices (%d)", n))
	}
	if len(hc.VolumesFrom) > 0 {
		out = append(out, "volumes-from "+strings.Join(hc.VolumesFrom, ", "))
	}
	if d := hc.LogConfig.Type; d != "" && d != "json-file" {
		out = append(out, "log driver "+d)
	}
	if len(hc.Links) > 0 {
		out = append(out, "links")
	}
	if m := networkMode(hc); m != "bridge" {
		out = append(out, "network mode "+m)
	}
	if hc.Init != nil && *hc.Init {
		out = append(out, "init")
	}
	if len(hc.Ulimits) > 0 {
		out = append(out, "ulimits")
	}
	if len(hc.Sysctls) > 0 {
		out = append(out, "sysctls")
	}
	if len(hc.DNS) > 0 {
		out = append(out, "dns")
	}
	if len(hc.ExtraHosts) > 0 {
		out = append(out, "extra hosts")
	}
	if cfg != nil {
		if cfg.Healthcheck != nil {
			out = append(out, "healthcheck")
		}
		if cfg.WorkingDir != "" {
			out = append(out, "workdir "+cfg.WorkingDir)
		}
		if cfg.StopSignal != "" {
			out = append(out, "stop signal "+cfg.StopSignal)
		}
	}
	return out
}

// dependentsOf lists the names of containers sharing id's network namespace.
func dependentsOf(id, name string, list []container.Summary) []string {
	out := []string{}
	for _, c := range list {
		mode := c.HostConfig.NetworkMode
		ref, ok := strings.CutPrefix(mode, "container:")
		if !ok || c.ID == id {
			continue
		}
		if ref == id || ref == name || ref == shortID(id) {
			out = append(out, trimName(c.Names))
		}
	}
	sort.Strings(out)
	return out
}

func (m *Manager) editSpec(ctx context.Context, id string) (EditSpec, error) {
	var out EditSpec
	err := m.call(ctx, callTimeout, func(ctx context.Context, cli *client.Client) error {
		res, err := cli.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
		if err != nil {
			return err
		}
		out = specFromInspect(res.Container)
		all, err := m.listAllContainers(ctx, cli)
		if err != nil {
			return err
		}
		out.Dependents = dependentsOf(res.Container.ID, out.InPlace.Name, all)
		return nil
	})
	return out, err
}

func isNetworkless(mode string) bool {
	return mode == "host" || mode == "none" || strings.HasPrefix(mode, "container:")
}

func swapSet(mem, swap int64) bool { return swap == -1 || swap == 0 || swap >= mem }

// validateInPlace checks in against cur (the live spec) with the engine's rules.
func validateInPlace(cur EditSpec, in InPlaceSpec) error {
	if !nameRe.MatchString(in.Name) {
		return invalid("name", "name must match [a-zA-Z0-9][a-zA-Z0-9_.-]+")
	}
	if err := validateResources(in.Resources); err != nil {
		return err
	}
	if err := validateClears(cur.InPlace.Resources, in.Resources); err != nil {
		return err
	}
	if err := container.ValidateRestartPolicy(container.RestartPolicy{Name: container.RestartPolicyMode(in.Restart.Name), MaximumRetryCount: in.Restart.MaxRetries}); err != nil {
		return invalid("restart", err.Error())
	}
	if cur.AutoRemove && in.Restart != cur.InPlace.Restart {
		return invalid("restart", "restart policy cannot change on an auto-remove container")
	}
	return validateNetworks(cur, in.Networks)
}

func validateResources(r Resources) error {
	switch {
	case r.Memory < 0 || r.MemoryReservation < 0:
		return invalid("resources.memory", "memory must not be negative")
	case r.Memory != 0 && r.Memory < minMemory:
		return invalid("resources.memory", "memory minimum is 6 MiB")
	case r.Memory != 0 && r.MemoryReservation > r.Memory:
		return invalid("resources.memoryReservation", "reservation must not exceed memory")
	case r.MemorySwap < -1 || !swapSet(r.Memory, r.MemorySwap):
		return invalid("resources.memorySwap", "swap must be -1, 0 or at least memory")
	case r.CPUShares != 0 && r.CPUShares < 2:
		return invalid("resources.cpuShares", "cpu shares must be 0 or at least 2")
	case r.BlkioWeight != 0 && (r.BlkioWeight < 10 || r.BlkioWeight > 1000):
		return invalid("resources.blkioWeight", "block IO weight must be 0 or 10 to 1000")
	case r.NanoCPUs < 0:
		return invalid("resources.nanoCpus", "cpus must not be negative")
	case r.NanoCPUs != 0 && (r.CPUQuota != 0 || r.CPUPeriod != 0):
		return invalid("resources.nanoCpus", "cpus and cpu quota cannot both be set")
	case r.CPUQuota < 0 || (r.CPUQuota != 0 && r.CPUQuota < 1000):
		return invalid("resources.cpuQuota", "cpu quota must be 0 or at least 1000")
	case r.CPUPeriod != 0 && (r.CPUPeriod < 1000 || r.CPUPeriod > 1000000):
		return invalid("resources.cpuPeriod", "cpu period must be 0 or 1000 to 1000000")
	case r.CpusetCpus != "" && !cpusetRe.MatchString(r.CpusetCpus):
		return invalid("resources.cpusetCpus", "cpuset must look like 0-2 or 0,1")
	case r.CpusetMems != "" && !cpusetRe.MatchString(r.CpusetMems):
		return invalid("resources.cpusetMems", "cpuset must look like 0-2 or 0,1")
	case r.PidsLimit < 0:
		return invalid("resources.pidsLimit", "pids limit must not be negative")
	}
	return nil
}

// validateClears rejects what the engine cannot do in place: it reads zero as "unchanged", so a set
// limit cannot be removed, and cpus cannot switch to quota or back.
func validateClears(c, r Resources) error {
	for _, f := range []struct {
		field    string
		had, now bool
	}{
		{"resources.cpuShares", c.CPUShares != 0, r.CPUShares == 0},
		{"resources.nanoCpus", c.NanoCPUs != 0, r.NanoCPUs == 0 && r.CPUQuota == 0},
		{"resources.cpuQuota", c.CPUQuota != 0, r.CPUQuota == 0 && r.NanoCPUs == 0},
		{"resources.cpuPeriod", c.CPUPeriod != 0, r.CPUPeriod == 0 && r.NanoCPUs == 0},
		{"resources.cpusetCpus", c.CpusetCpus != "", r.CpusetCpus == ""},
		{"resources.cpusetMems", c.CpusetMems != "", r.CpusetMems == ""},
		{"resources.memory", c.Memory != 0, r.Memory == 0},
		{"resources.memoryReservation", c.MemoryReservation != 0, r.MemoryReservation == 0},
		{"resources.memorySwap", c.MemorySwap != 0, r.MemorySwap == 0},
		{"resources.blkioWeight", c.BlkioWeight != 0, r.BlkioWeight == 0},
	} {
		if f.had && f.now {
			return invalid(f.field, "removing this limit needs a recreate")
		}
	}
	if (c.NanoCPUs != 0 && (r.CPUQuota != 0 || r.CPUPeriod != 0)) || ((c.CPUQuota != 0 || c.CPUPeriod != 0) && r.NanoCPUs != 0) {
		return invalid("resources.nanoCpus", "switching between cpus and cpu quota needs a recreate")
	}
	return nil
}

func validateNetworks(cur EditSpec, nets []EditNetwork) error {
	seen := map[string]bool{}
	for _, n := range nets {
		if n.Name == "" || seen[n.Name] {
			return invalid("networks", "network names must be unique and non-empty")
		}
		seen[n.Name] = true
		if len(n.Aliases) > 0 && (n.Name == "bridge" || n.Name == "host" || n.Name == "none") {
			return invalid("networks."+n.Name, "aliases are not supported on the "+n.Name+" network")
		}
	}
	if isNetworkless(cur.NetworkMode) && !sameNetworks(cur.InPlace.Networks, nets) {
		return invalid("networks", "networks cannot change in "+cur.NetworkMode+" network mode")
	}
	return nil
}

func sameNetworks(a, b []EditNetwork) bool {
	if len(a) != len(b) {
		return false
	}
	bm := map[string]EditNetwork{}
	for _, n := range b {
		bm[n.Name] = n
	}
	for _, n := range a {
		o, ok := bm[n.Name]
		if !ok || strings.Join(o.Aliases, ",") != strings.Join(n.Aliases, ",") {
			return false
		}
	}
	return true
}

// validateRecreate checks the parts of rc that need no engine.
func validateRecreate(cur EditSpec, in InPlaceSpec, rc RecreateSpec) error {
	if cur.AutoRemove {
		return ipcerr.New("E_INVALID", "an auto-remove container cannot be recreated: stopping it deletes it")
	}
	if strings.TrimSpace(rc.Image) == "" {
		return invalid("recreate.image", "image is required")
	}
	if !nameRe.MatchString(in.Name) {
		return invalid("name", "name must match [a-zA-Z0-9][a-zA-Z0-9_.-]+")
	}
	if err := validateNetworks(cur, in.Networks); err != nil {
		return err
	}
	seenPort := map[PortBinding]bool{}
	for _, p := range rc.Ports {
		switch {
		case p.ContainerPort < 1 || p.ContainerPort > 65535:
			return invalid("recreate.ports", "container port must be 1 to 65535")
		case p.Proto != "tcp" && p.Proto != "udp" && p.Proto != "sctp":
			return invalid("recreate.ports", "protocol must be tcp, udp or sctp")
		case seenPort[p]:
			return invalid("recreate.ports", fmt.Sprintf("duplicate port %d/%s", p.ContainerPort, p.Proto))
		}
		if p.HostPort != "" {
			if n, err := strconv.Atoi(p.HostPort); err != nil || n < 0 || n > 65535 {
				return invalid("recreate.ports", "host port must be a number from 0 to 65535")
			}
		}
		if p.HostIP != "" {
			if _, err := netip.ParseAddr(p.HostIP); err != nil {
				return invalid("recreate.ports", "host IP is not a valid address")
			}
		}
		seenPort[p] = true
	}
	targets := map[string]bool{}
	for _, row := range rc.Mounts {
		switch {
		case row.Type != "bind" && row.Type != "volume":
			return invalid("recreate.mounts", "mount type must be bind or volume")
		case !strings.HasPrefix(row.Target, "/"):
			return invalid("recreate.mounts", "mount target must be an absolute path")
		case targets[row.Target]:
			return invalid("recreate.mounts", "duplicate mount target "+row.Target)
		case row.Source == "":
			return invalid("recreate.mounts", "mount source is required")
		}
		targets[row.Target] = true
	}
	for _, e := range rc.Env {
		if k, _, ok := strings.Cut(e, "="); !ok || k == "" {
			return invalid("recreate.env", "env entries must look like KEY=value")
		}
	}
	return nil
}
