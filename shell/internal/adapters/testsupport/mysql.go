package testsupport

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	sqldriver "github.com/go-sql-driver/mysql"
	"github.com/testcontainers/testcontainers-go"
	tcmysql "github.com/testcontainers/testcontainers-go/modules/mysql"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// MysqlFixture is support/mysql.ts's MysqlFixture.
type MysqlFixture struct {
	URI       string
	Config    model.ResolvedConnectionConfig
	container testcontainers.Container
}

var mysqlMemo fixture[MysqlFixture]

const (
	mysqlImage        = "mysql:8.4"
	mysqlRootPassword = "kira"
	mysqlDatabase     = "kira_test"
	mysqlAnalyticsDB  = "kira_analytics"
	mysqlUsername     = "kira"
	mysqlPassword     = "kira"
)

// StartMysql is support/mysql.ts's startMysql. See fixture.go's own doc comment for why
// termination is never wired to t.Cleanup (B15).
func StartMysql(t *testing.T) *MysqlFixture {
	t.Helper()
	if !IsDockerAvailable() {
		t.Skip(DockerUnavailableMessage)
	}
	fixture, err := mysqlMemo.get(startMysql)
	if err != nil {
		t.Fatalf("mysql container: %v", err)
	}
	return fixture
}

// StopMysql terminates the memoized container, if one was ever started. Call once, from the test
// binary's own TestMain, after m.Run() returns — never from an individual test.
func StopMysql() {
	mysqlMemo.stop(func(f *MysqlFixture) { _ = f.container.Terminate(context.Background()) })
}

func startMysql() (*MysqlFixture, error) {
	ctx := context.Background()

	container, err := tcmysql.Run(ctx, mysqlImage,
		tcmysql.WithDatabase(mysqlDatabase),
		tcmysql.WithUsername(mysqlUsername),
		tcmysql.WithPassword(mysqlPassword),
		testcontainers.WithEnv(map[string]string{"MYSQL_ROOT_PASSWORD": mysqlRootPassword}),
	)
	if err != nil {
		return nil, err
	}

	host, err := container.Host(ctx)
	if err != nil {
		return nil, err
	}
	port, err := container.MappedPort(ctx, "3306/tcp")
	if err != nil {
		return nil, err
	}
	portNum := int(port.Num())

	seedPath := filepath.Join(repoRoot(), "tests", "db", "fixtures", "0008_mysql_seed.sql")
	seedSQL, err := os.ReadFile(seedPath)
	if err != nil {
		return nil, err
	}

	rootDSN := rootMysqlDSN(host, portNum, mysqlDatabase)
	if err := seedMysqlFamilyDatabase(ctx, rootDSN, string(seedSQL)); err != nil {
		return nil, err
	}
	if err := seedMysqlExtras(ctx, host, portNum); err != nil {
		return nil, err
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	hostCopy, portCopy := host, portNum
	cfg := model.ResolvedConnectionConfig{
		ID: "test-mysql", SortOrder: 0, CreatedAt: now, UpdatedAt: now,
		Name: "Test MySQL", Kind: "mysql", Color: "teal", Mode: "fields", ReadOnly: false,
		Host: &hostCopy, Port: &portCopy, Database: Strp(mysqlDatabase), Username: Strp(mysqlUsername),
		// P34 D5/D26: TLS is available on a stock server (MySQL auto-generates a self-signed
		// certificate at init) — this exercises the real remedy path, not a worked-around one.
		Options:  map[string]any{"sslmode": "require"},
		Password: Strp(mysqlPassword),
	}
	uri := fmt.Sprintf("mysql://%s:%s@%s:%d/%s", mysqlUsername, mysqlPassword, host, portNum, mysqlDatabase)
	return &MysqlFixture{URI: uri, Config: cfg, container: container}, nil
}

func rootMysqlDSN(host string, port int, database string) string {
	cfg := sqldriver.NewConfig()
	cfg.Net = "tcp"
	cfg.Addr = fmt.Sprintf("%s:%d", host, port)
	cfg.User = "root"
	cfg.Passwd = mysqlRootPassword
	cfg.DBName = database
	cfg.MultiStatements = true
	cfg.AllowNativePasswords = true
	return cfg.FormatDSN()
}

// seedMysqlExtras is support/mysql.ts's own root-connection block: the second database (mirroring
// MariaDB's kira_analytics, §6d) and the big_rows bulk insert. P34 D28: MySQL has no SEQUENCE
// storage engine, so the 1,000,000-row insert uses the conventional numbers-table idiom instead —
// a six-way cross join over a 10-row digits table, chunked into ten 100,000-row statements so any
// single InnoDB transaction stays bounded.
func seedMysqlExtras(ctx context.Context, host string, port int) error {
	db, err := sql.Open("mysql", rootMysqlDSN(host, port, mysqlDatabase))
	if err != nil {
		return err
	}
	defer db.Close()

	if _, err := db.ExecContext(ctx, "CREATE DATABASE IF NOT EXISTS `"+mysqlAnalyticsDB+"`"); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS `"+mysqlAnalyticsDB+"`.events ("+
		"id INT AUTO_INCREMENT PRIMARY KEY, event_name VARCHAR(255) NOT NULL, "+
		"occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)"); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO `"+mysqlAnalyticsDB+"`.events (event_name) VALUES ('signup'), ('login')"); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, "GRANT SELECT ON `"+mysqlAnalyticsDB+"`.* TO '"+mysqlUsername+"'@'%'"); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, "FLUSH PRIVILEGES"); err != nil {
		return err
	}

	// A plain table, not TEMPORARY: MySQL's TEMPORARY tables can't be referenced more than once in
	// the same query, and the six-way self-join below does exactly that. Dropped once done.
	if _, err := db.ExecContext(ctx, "CREATE TABLE digits (d INT PRIMARY KEY)"); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO digits (d) VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)"); err != nil {
		return err
	}
	for outer := 0; outer < 10; outer++ {
		if _, err := db.ExecContext(ctx,
			fmt.Sprintf(`INSERT INTO `+"`%s`"+`.big_rows (id, payload)
			 SELECT d1.d*100000 + d2.d*10000 + d3.d*1000 + d4.d*100 + d5.d*10 + d6.d + 1 AS id,
			        MD5(d1.d*100000 + d2.d*10000 + d3.d*1000 + d4.d*100 + d5.d*10 + d6.d + 1) AS payload
			 FROM digits d1, digits d2, digits d3, digits d4, digits d5, digits d6
			 WHERE d1.d = ?`, mysqlDatabase), outer,
		); err != nil {
			return err
		}
	}
	if _, err := db.ExecContext(ctx, "DROP TABLE digits"); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, "ANALYZE TABLE `"+mysqlDatabase+"`.big_rows"); err != nil {
		return err
	}
	return nil
}
