/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Barlow', 'system-ui', 'sans-serif'],
        condensed: ['Barlow Condensed', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        // Pyramid brand
        pyramid: {
          50:  '#fff7ed',
          100: '#ffedd5',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          900: '#7c2d12',
        },
        // App chrome
        ink: {
          950: '#0F1923',
          900: '#111827',
          800: '#1f2937',
          700: '#374151',
          600: '#4b5563',
          500: '#6b7280',
          400: '#9ca3af',
          300: '#d1d5db',
          200: '#e5e7eb',
          100: '#f3f4f6',
          50:  '#f9fafb',
        },
        // Division colors
        regular: { DEFAULT: '#3b82f6', light: '#dbeafe', dark: '#1d4ed8' },
        ira:     { DEFAULT: '#8b5cf6', light: '#ede9fe', dark: '#6d28d9' },
        // Status colors
        status: {
          new:         '#6b7280',
          active_bid:  '#3b82f6',
          no_bid:      '#ef4444',
          not_awarded: '#f97316',
          awarded:     '#10b981',
          active_job:  '#059669',
          closed:      '#374151',
        }
      },
      boxShadow: {
        'sidebar': '1px 0 0 0 rgba(255,255,255,0.06)',
        'card':    '0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)',
        'card-md': '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
      }
    },
  },
  plugins: [],
}
