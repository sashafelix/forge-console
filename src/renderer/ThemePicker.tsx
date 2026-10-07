import { useConsoleTheme } from './useConsoleTheme';

export function ThemePicker() {
  const [theme, setTheme] = useConsoleTheme();
  return <label className="console-theme-picker"><span>Theme</span>
    <select aria-label="Colour theme" value={theme} onChange={(event) => setTheme(event.target.value)}>
      <option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option>
    </select>
  </label>;
}
