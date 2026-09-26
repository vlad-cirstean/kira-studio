package appupdate

// App names one of the two installable apps — the same two rows scripts/install.sh's own table
// holds (its own --app table): ScriptArg is that script's --app= value, Name is what the checker
// stamps into its User-Agent and what the installer passes through to the script and shows in the
// dialog.
type App struct{ Name, ScriptArg string }

var (
	Studio = App{Name: "Kira Studio", ScriptArg: "studio"}
	Space  = App{Name: "Kira Space", ScriptArg: "space"}
)
