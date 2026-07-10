export const THEME_STORAGE_KEY = "system-theme-cache:v1";

export const DEFAULT_SYSTEM_THEME = {
  key: "system-theme",
  primaryColor: "#0ea5e9",
  secondaryColor: "#06b6d4",
  sidebarBg: "#f9fafb",
  sidebarActiveGradientFrom: "#2563eb",
  sidebarActiveGradientTo: "#1d4ed8",
  tableHeaderGradientFrom: "#0284c7",
  tableHeaderGradientTo: "#0369a1",
  buttonPrimaryBg: "#0284c7",
  buttonPrimaryHover: "#0369a1",
  pageBg: "#f9fafb",
  successColor: "#10b981",
  warningColor: "#f59e0b",
  errorColor: "#ef4444",
  infoColor: "#3b82f6",
  presetName: "Default Blue",
};

function hexToHSL(hex) {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  const normalized = hex.replace(shorthandRegex, (_match, red, green, blue) => red + red + green + green + blue + blue);
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalized);

  if (!result) {
    return { h: 200, s: 84, l: 48 };
  }

  const red = parseInt(result[1], 16) / 255;
  const green = parseInt(result[2], 16) / 255;
  const blue = parseInt(result[3], 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  let h;
  let s;
  const l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const delta = max - min;
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case red:
        h = (green - blue) / delta + (green < blue ? 6 : 0);
        break;
      case green:
        h = (blue - red) / delta + 2;
        break;
      default:
        h = (red - green) / delta + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function hslToHex(h, s, l) {
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs((h / 60) % 2 - 1));
  const match = lightness - chroma / 2;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (h >= 0 && h < 60) {
    red = chroma;
    green = x;
  } else if (h >= 60 && h < 120) {
    red = x;
    green = chroma;
  } else if (h >= 120 && h < 180) {
    green = chroma;
    blue = x;
  } else if (h >= 180 && h < 240) {
    green = x;
    blue = chroma;
  } else if (h >= 240 && h < 300) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  const toHex = (value) => {
    const hex = Math.round((value + match) * 255).toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized;
  const int = parseInt(value, 16);

  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function rgbaString(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function generatePalette(baseColor) {
  const { h, s } = hexToHSL(baseColor);

  return {
    50: hslToHex(h, Math.max(s - 25, 20), 97),
    100: hslToHex(h, Math.max(s - 20, 24), 93),
    200: hslToHex(h, Math.max(s - 12, 34), 86),
    300: hslToHex(h, Math.max(s - 6, 44), 76),
    400: hslToHex(h, Math.max(s - 2, 50), 63),
    500: hslToHex(h, s, 52),
    600: hslToHex(h, Math.min(s + 4, 100), 44),
    700: hslToHex(h, Math.min(s + 6, 100), 36),
    800: hslToHex(h, Math.min(s + 8, 100), 28),
    900: hslToHex(h, Math.min(s + 10, 100), 18),
  };
}

function applyPalette(root, prefix, palette) {
  Object.entries(palette).forEach(([shade, color]) => {
    root.style.setProperty(`--${prefix}-${shade}`, color);
  });
}

export function readCachedSystemTheme() {
  if (typeof window === "undefined") return null;

  try {
    const cached = window.localStorage.getItem(THEME_STORAGE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

export function persistSystemTheme(theme) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // Ignore storage failures.
  }
}

export function applySystemThemeToDOM(themeConfig) {
  if (typeof document === "undefined") return;

  const theme = { ...DEFAULT_SYSTEM_THEME, ...(themeConfig || {}) };
  const root = document.documentElement;
  const primary = generatePalette(theme.primaryColor || DEFAULT_SYSTEM_THEME.primaryColor);
  const secondary = generatePalette(theme.secondaryColor || DEFAULT_SYSTEM_THEME.secondaryColor);
  const success = generatePalette(theme.successColor || DEFAULT_SYSTEM_THEME.successColor);
  const warning = generatePalette(theme.warningColor || DEFAULT_SYSTEM_THEME.warningColor);
  const error = generatePalette(theme.errorColor || DEFAULT_SYSTEM_THEME.errorColor);
  const info = generatePalette(theme.infoColor || DEFAULT_SYSTEM_THEME.infoColor);
  const brandBase = theme.buttonPrimaryBg || primary[600];
  const brandHover = theme.buttonPrimaryHover || primary[700];
  const pageBg = theme.pageBg || DEFAULT_SYSTEM_THEME.pageBg;

  applyPalette(root, "color-primary", primary);
  applyPalette(root, "color-secondary", secondary);
  applyPalette(root, "color-success", success);
  applyPalette(root, "color-warning", warning);
  applyPalette(root, "color-error", error);
  applyPalette(root, "color-info", info);

  root.style.setProperty("--background", pageBg);
  root.style.setProperty("--background-soft", primary[50]);
  root.style.setProperty("--background-elevated", secondary[50]);
  root.style.setProperty("--foreground", primary[900]);
  root.style.setProperty("--foreground-strong", primary[900]);
  root.style.setProperty("--foreground-muted", rgbaString(primary[800], 0.68));
  root.style.setProperty("--panel-background", rgbaString(primary[800], 0.9));
  root.style.setProperty("--panel-background-strong", rgbaString(primary[900], 0.96));
  root.style.setProperty("--panel-background-accent", rgbaString(secondary[800], 0.92));
  root.style.setProperty("--panel-foreground", "#eefaff");
  root.style.setProperty("--panel-foreground-strong", "#ffffff");
  root.style.setProperty("--panel-foreground-muted", secondary[100]);
  root.style.setProperty("--border-subtle", rgbaString(primary[700], 0.18));
  root.style.setProperty("--border-strong", rgbaString(primary[700], 0.28));
  root.style.setProperty("--focus-ring", rgbaString(secondary[500], 0.24));
  root.style.setProperty("--panel-glow-primary", rgbaString(primary[300], 0.18));
  root.style.setProperty("--panel-glow-secondary", rgbaString(secondary[400], 0.16));
  root.style.setProperty("--shadow-sm", `0 8px 18px ${rgbaString(primary[800], 0.08)}`);
  root.style.setProperty("--shadow-md", `0 16px 36px ${rgbaString(primary[800], 0.12)}`);
  root.style.setProperty("--shadow-lg", `0 24px 52px ${rgbaString(primary[900], 0.16)}`);
  root.style.setProperty("--brand-shadow", `0 18px 40px ${rgbaString(brandHover, 0.18)}`);
  root.style.setProperty("--accent-shadow", `0 18px 36px ${rgbaString(secondary[700], 0.18)}`);
  root.style.setProperty("--radius-sm", "0.22rem");
  root.style.setProperty("--radius-md", "0.38rem");
  root.style.setProperty("--radius-lg", "0.58rem");
  root.style.setProperty("--radius-xl", "0.82rem");
  root.style.setProperty("--radius-2xl", "1.02rem");
  root.style.setProperty("--brand", brandBase);
  root.style.setProperty("--brand-strong", brandHover);
  root.style.setProperty("--accent", secondary[400]);
  root.style.setProperty("--accent-strong", secondary[600]);

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute("content", brandBase);
  }
}