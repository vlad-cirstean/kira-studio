// Play CDN config for the design-review mockups only — not part of the app build.
// Every color is a passthrough to the app's real custom properties
// (src/renderer/theme/tokens.css), so nothing here can drift from the real theme.
tailwind.config = {
  theme: {
    extend: {
      colors: {
        bg: 'var(--kira-bg)',
        elevated: 'var(--kira-bg-elevated)',
        chrome: 'var(--kira-bg-chrome)',
        input: 'var(--kira-bg-input)',
        fg: 'var(--kira-fg)',
        muted: 'var(--kira-fg-muted)',
        disabled: 'var(--kira-fg-disabled)',
        line: 'var(--kira-border)',
        'line-strong': 'var(--kira-border-strong)',
        focus: 'var(--kira-focus)',
        accent: 'var(--kira-accent)',
        'accent-fg': 'var(--kira-accent-fg)',
        select: 'var(--kira-select)',
        hover: 'var(--kira-hover)',
        badge: 'var(--kira-badge)',
        err: 'var(--kira-error)',
        warn: 'var(--kira-warn)',
        ok: 'var(--kira-ok)',
        info: 'var(--kira-info)',
        'conn-red': 'var(--kira-conn-red)',
        'conn-orange': 'var(--kira-conn-orange)',
        'conn-amber': 'var(--kira-conn-amber)',
        'conn-olive': 'var(--kira-conn-olive)',
        'conn-green': 'var(--kira-conn-green)',
        'conn-teal': 'var(--kira-conn-teal)',
        'conn-cyan': 'var(--kira-conn-cyan)',
        'conn-blue': 'var(--kira-conn-blue)',
        'conn-indigo': 'var(--kira-conn-indigo)',
        'conn-violet': 'var(--kira-conn-violet)',
        'conn-magenta': 'var(--kira-conn-magenta)',
        'conn-grey': 'var(--kira-conn-grey)',
      },
      borderRadius: {
        kira: 'var(--kira-radius)',
      },
      boxShadow: {
        kira: 'var(--kira-shadow)',
      },
    },
  },
};
