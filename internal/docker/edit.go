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

// invalid refuses a form value with catalog text; the field name lets the editor mark the input.
func invalid(field, key string, params map[string]string) error {
	return withField(ipcerr.T(ipcerr.CodeBadRequest, key, params), field)
}

// invalidRaw refuses a form value with text from the engine, verbatim.
func invalidRaw(field, msg string) error {
	return withField(ipcerr.BadRequest(msg), field)
}

func withField(e *ipcerr.Error, field string) error {
	e.Details, _ = json.Marshal(map[string]string{"field": field})
	return e
}

func (s EditSpec) readOnlyErr() error {
	if s.Managed != "" {
		return ipcerr.T(ipcerr.CodeBadRequest, "backend.core.docker.edit.managed.body", map[string]string{"managed": s.Managed})
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
		return invalid("name", "backend.core.docker.edit.nameInvalid.body", nil)
	}
	if err := validateResources(in.Resources); err != nil {
		return err
	}
	if err := validateClears(cur.InPlace.Resources, in.Resources); err != nil {
		return err
	}
	if err := container.ValidateRestartPolicy(container.RestartPolicy{Name: container.RestartPolicyMode(in.Restart.Name), MaximumRetryCount: in.Restart.MaxRetries}); err != nil {
		return invalidRaw("restart", err.Error())
	}
	if cur.AutoRemove && in.Restart != cur.InPlace.Restart {
		return invalid("restart", "backend.core.docker.edit.restartAutoRemove.body", nil)
	}
	return validateNetworks(cur, in.Networks)
}

func validateResources(r Resources) error {
	switch {
	case r.Memory < 0 || r.MemoryReservation < 0:
		return invalid("resources.memory", "backend.core.docker.edit.memoryNegative.body", nil)
	case r.Memory != 0 && r.Memory < minMemory:
		return invalid("resources.memory", "backend.core.docker.edit.memoryMinimum.body", nil)
	case r.Memory != 0 && r.MemoryReservation > r.Memory:
		return invalid("resources.memoryReservation", "backend.core.docker.edit.reservationExceeds.body", nil)
	case r.MemorySwap < -1 || !swapSet(r.Memory, r.MemorySwap):
		return invalid("resources.memorySwap", "backend.core.docker.edit.swapInvalid.body", nil)
	case r.CPUShares != 0 && r.CPUShares < 2:
		return invalid("resources.cpuShares", "backend.core.docker.edit.cpuSharesInvalid.body", nil)
	case r.BlkioWeight != 0 && (r.BlkioWeight < 10 || r.BlkioWeight > 1000):
		return invalid("resources.blkioWeight", "backend.core.docker.edit.blkioWeightInvalid.body", nil)
	case r.NanoCPUs < 0:
		return invalid("resources.nanoCpus", "backend.core.docker.edit.cpusNegative.body", nil)
	case r.NanoCPUs != 0 && (r.CPUQuota != 0 || r.CPUPeriod != 0):
		return invalid("resources.nanoCpus", "backend.core.docker.edit.cpusAndQuota.body", nil)
	case r.CPUQuota < 0 || (r.CPUQuota != 0 && r.CPUQuota < 1000):
		return invalid("resources.cpuQuota", "backend.core.docker.edit.cpuQuotaInvalid.body", nil)
	case r.CPUPeriod != 0 && (r.CPUPeriod < 1000 || r.CPUPeriod > 1000000):
		return invalid("resources.cpuPeriod", "backend.core.docker.edit.cpuPeriodInvalid.body", nil)
	case r.CpusetCpus != "" && !cpusetRe.MatchString(r.CpusetCpus):
		return invalid("resources.cpusetCpus", "backend.core.docker.edit.cpusetInvalid.body", nil)
	case r.CpusetMems != "" && !cpusetRe.MatchString(r.CpusetMems):
		return invalid("resources.cpusetMems", "backend.core.docker.edit.cpusetInvalid.body", nil)
	case r.PidsLimit < 0:
		return invalid("resources.pidsLimit", "backend.core.docker.edit.pidsNegative.body", nil)
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
			return invalid(f.field, "backend.core.docker.edit.limitRemoveRecreate.body", nil)
		}
	}
	if (c.NanoCPUs != 0 && (r.CPUQuota != 0 || r.CPUPeriod != 0)) || ((c.CPUQuota != 0 || c.CPUPeriod != 0) && r.NanoCPUs != 0) {
		return invalid("resources.nanoCpus", "backend.core.docker.edit.cpuSwitchRecreate.body", nil)
	}
	return nil
}

func validateNetworks(cur EditSpec, nets []EditNetwork) error {
	seen := map[string]bool{}
	for _, n := range nets {
		if n.Name == "" || seen[n.Name] {
			return invalid("networks", "backend.core.docker.edit.networkNames.body", nil)
		}
		seen[n.Name] = true
		if len(n.Aliases) > 0 && (n.Name == "bridge" || n.Name == "host" || n.Name == "none") {
			return invalid("networks."+n.Name, "backend.core.docker.edit.aliasesUnsupported.body", map[string]string{"network": n.Name})
		}
	}
	if isNetworkless(cur.NetworkMode) && !sameNetworks(cur.InPlace.Networks, nets) {
		return invalid("networks", "backend.core.docker.edit.networksFixed.body", map[string]string{"mode": cur.NetworkMode})
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
		return ipcerr.T(ipcerr.CodeBadRequest, "backend.core.docker.edit.autoRemoveRecreate.body", nil)
	}
	if strings.TrimSpace(rc.Image) == "" {
		return invalid("recreate.image", "backend.core.docker.edit.imageRequired.body", nil)
	}
	if !nameRe.MatchString(in.Name) {
		return invalid("name", "backend.core.docker.edit.nameInvalid.body", nil)
	}
	if err := validateNetworks(cur, in.Networks); err != nil {
		return err
	}
	seenPort := map[PortBinding]bool{}
	for _, p := range rc.Ports {
		switch {
		case p.ContainerPort < 1 || p.ContainerPort > 65535:
			return invalid("recreate.ports", "backend.core.docker.edit.containerPortRange.body", nil)
		case p.Proto != "tcp" && p.Proto != "udp" && p.Proto != "sctp":
			return invalid("recreate.ports", "backend.core.docker.edit.protocolInvalid.body", nil)
		case seenPort[p]:
			return invalid("recreate.ports", "backend.core.docker.edit.duplicatePort.body", map[string]string{"port": strconv.Itoa(p.ContainerPort), "protocol": p.Proto})
		}
		if p.HostPort != "" {
			if n, err := strconv.Atoi(p.HostPort); err != nil || n < 0 || n > 65535 {
				return invalid("recreate.ports", "backend.core.docker.edit.hostPortRange.body", nil)
			}
		}
		if p.HostIP != "" {
			if _, err := netip.ParseAddr(p.HostIP); err != nil {
				return invalid("recreate.ports", "backend.core.docker.edit.hostIpInvalid.body", nil)
			}
		}
		seenPort[p] = true
	}
	targets := map[string]bool{}
	for _, row := range rc.Mounts {
		switch {
		case row.Type != "bind" && row.Type != "volume":
			return invalid("recreate.mounts", "backend.core.docker.edit.mountType.body", nil)
		case !strings.HasPrefix(row.Target, "/"):
			return invalid("recreate.mounts", "backend.core.docker.edit.mountTargetAbsolute.body", nil)
		case targets[row.Target]:
			return invalid("recreate.mounts", "backend.core.docker.edit.duplicateMount.body", map[string]string{"target": row.Target})
		case row.Source == "":
			return invalid("recreate.mounts", "backend.core.docker.edit.mountSourceRequired.body", nil)
		}
		targets[row.Target] = true
	}
	for _, e := range rc.Env {
		if k, _, ok := strings.Cut(e, "="); !ok || k == "" {
			return invalid("recreate.env", "backend.core.docker.edit.envEntry.body", nil)
		}
	}
	return nil
}
