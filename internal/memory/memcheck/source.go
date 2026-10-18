package memcheck

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/internal/memory/memfmt"
)

const (
	maxFileSize = 4 << 20
	nulProbe    = 8 << 10
	gitTimeout  = 30 * time.Second
)

// usable drops files over the size cap and binary files.
func usable(data []byte) bool {
	if len(data) > maxFileSize {
		return false
	}
	return !bytes.Contains(data[:min(len(data), nulProbe)], []byte{0})
}

// slim drops the content of a file that cannot hold a finding, so a large tree is not held in
// memory: only doc files and files naming kira-memory keep their bytes. The file still counts.
func slim(path string, data []byte) []byte {
	if memfmt.IsDocPath(path) || bytes.Contains(data, []byte("kira-memory")) {
		return data
	}
	return nil
}

// lister yields the files to check.
type lister interface {
	Files(ctx context.Context) ([]Source, error)
}

func git(ctx context.Context, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return out, nil
}

func inWorkTree(ctx context.Context) bool {
	out, err := git(ctx, "rev-parse", "--is-inside-work-tree")
	return err == nil && strings.TrimSpace(string(out)) == "true"
}

func splitNUL(b []byte) []string {
	var out []string
	for _, p := range strings.Split(string(b), "\x00") {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// readDisk reads each path from the work tree.
func readDisk(paths []string) []Source {
	var out []Source
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil || !usable(data) {
			continue
		}
		out = append(out, Source{p, slim(p, data)})
	}
	return out
}

// tracked is `git ls-files` under the given paths, read from disk.
type tracked struct{ paths []string }

func (t tracked) Files(ctx context.Context) ([]Source, error) {
	args := append([]string{"ls-files", "-z", "--"}, t.paths...)
	out, err := git(ctx, args...)
	if err != nil {
		return nil, err
	}
	return readDisk(splitNUL(out)), nil
}

// walk visits paths outside git, skipping dot directories and node_modules.
type walk struct{ paths []string }

func (w walk) Files(context.Context) ([]Source, error) {
	var found []string
	for _, root := range w.paths {
		err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				if p != root && (strings.HasPrefix(d.Name(), ".") || d.Name() == "node_modules") {
					return filepath.SkipDir
				}
				return nil
			}
			found = append(found, p)
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	return readDisk(found), nil
}

// staged reads the index blobs of added, copied, modified and renamed files, so a hook checks
// what is committed rather than the work tree.
type staged struct{}

func (staged) Files(ctx context.Context) ([]Source, error) {
	out, err := git(ctx, "diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR")
	if err != nil {
		return nil, err
	}
	var paths []string
	for _, p := range splitNUL(out) {
		if !strings.Contains(p, "\n") {
			paths = append(paths, p)
		}
	}
	if len(paths) == 0 {
		return nil, nil
	}
	return catBlobs(ctx, paths)
}

// catBlobs reads ":path" index blobs through one `git cat-file --batch`.
func catBlobs(ctx context.Context, paths []string) ([]Source, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	var in bytes.Buffer
	for _, p := range paths {
		in.WriteString(":" + p + "\n")
	}
	cmd := exec.CommandContext(ctx, "git", "cat-file", "--batch")
	cmd.Stdin = &in
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git cat-file --batch: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return parseBatch(paths, bytes.NewReader(out))
}

// parseBatch reads `cat-file --batch` output: "<oid> <type> <size>\n<content>\n" per path, or
// "<spec> missing\n".
func parseBatch(paths []string, r io.Reader) ([]Source, error) {
	br := bufio.NewReader(r)
	var out []Source
	for _, p := range paths {
		head, err := br.ReadString('\n')
		if err != nil {
			return nil, fmt.Errorf("git cat-file: short output at %s: %w", p, err)
		}
		f := strings.Fields(head)
		if len(f) == 3 && f[1] == "blob" {
			size, err := strconv.Atoi(f[2])
			if err != nil {
				return nil, fmt.Errorf("git cat-file: bad size %q", f[2])
			}
			data := make([]byte, size)
			if _, err := io.ReadFull(br, data); err != nil {
				return nil, err
			}
			if _, err := br.ReadByte(); err != nil && !errors.Is(err, io.EOF) {
				return nil, err
			}
			if usable(data) {
				out = append(out, Source{p, slim(p, data)})
			}
			continue
		}
		if len(f) != 2 || f[1] != "missing" {
			return nil, fmt.Errorf("git cat-file: unexpected line %q", strings.TrimSpace(head))
		}
	}
	return out, nil
}
