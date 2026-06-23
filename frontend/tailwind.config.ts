import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#00B2E3', dark: '#0891b2', light: '#E0F7FA' },
        success: { DEFAULT: '#10b981', dark: '#059669' },
        error: { DEFAULT: '#ef4444', dark: '#dc2626' },
        background: '#f8fafc',
        surface: '#ffffff',
        textPrimary: '#1e293b',
        textSecondary: '#64748b',
        border: '#e2e8f0',
      },
    },
  },
  plugins: [],
}

export default config
