package postmanstore

import "github.com/shirou/gopsutil/v4/process"

// postmanRunning reports whether a Postman process is currently running — checked before ever
// touching a store directory (P2 plan §2/§7): goleveldb's flock and Chromium leveldb's own fcntl
// lock live in separate lock spaces and don't conflict with each other, so a live Postman would
// not otherwise stop this package from racing its writes.
func postmanRunning() (bool, error) {
	procs, err := process.Processes()
	if err != nil {
		return false, err
	}
	for _, p := range procs {
		name, err := p.Name()
		if err != nil || name == "" {
			continue
		}
		if isPostmanProcessName(name) {
			return true, nil
		}
	}
	return false, nil
}

func isPostmanProcessName(name string) bool {
	return name == "Postman" || name == "postman"
}
