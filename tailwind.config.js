/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Crimson Pro"', 'Georgia', 'serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace']
      },
      colors: {
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        paper: 'var(--paper)',
        'paper-2': 'var(--paper-2)',
        'paper-3': 'var(--paper-3)',
        line: 'var(--line)',
        'line-2': 'var(--line-2)',
        mute: 'var(--mute)',
        'mute-2': 'var(--mute-2)',
        oxblood: 'var(--oxblood)',
        'oxblood-2': 'var(--oxblood-2)',
        moss: 'var(--moss)',
        amber: 'var(--amber)',
        rust: 'var(--rust)'
      }
    }
  },
  plugins: []
}
