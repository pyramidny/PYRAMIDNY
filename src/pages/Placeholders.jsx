import { Construction, ScanLine, ExternalLink } from 'lucide-react'

// Fill this in once the Tool Control demo (scan.html) is hosted — e.g. a
// Netlify path like '/tools-demo/' or a standalone URL. Leave empty to show
// the "In Development" badge with no outbound link.
const TOOL_DEMO_URL = ''

// -- Tool Control -----------------------------------
export function ToolControl() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-pyramid-50 flex items-center justify-center mb-5">
        <ScanLine size={28} className="text-pyramid-500" />
      </div>
      <h2 className="text-xl font-condensed font-bold text-ink-800 tracking-wide mb-2">
        Tool Control
      </h2>
      <p className="text-ink-400 text-sm max-w-sm leading-relaxed">
        Scan-tag check-in / check-out for the tool fleet — who has each tool,
        what job it's on, condition going out and coming back, and a printable
        QR tag for every asset.
      </p>
      {TOOL_DEMO_URL ? (
        <a
          href={TOOL_DEMO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary mt-6 inline-flex items-center gap-2 text-sm"
        >
          <ExternalLink size={15} /> Open the demo
        </a>
      ) : (
        <div className="mt-6 px-4 py-2 rounded-full bg-pyramid-50 border border-pyramid-100 text-pyramid-600 text-xs font-medium">
          In Development
        </div>
      )}
    </div>
  )
}

// -- Team -------------------------------------------
export function Team() {
  return <Placeholder title="Team" description="User directory, role assignments, and division access management." />
}

// -- Shared placeholder --------------------------------
function Placeholder({ title, description }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-pyramid-50 flex items-center justify-center mb-5">
        <Construction size={28} className="text-pyramid-500" />
      </div>
      <h2 className="text-xl font-condensed font-bold text-ink-800 tracking-wide mb-2">
        {title}
      </h2>
      <p className="text-ink-400 text-sm max-w-xs leading-relaxed">{description}</p>
      <div className="mt-6 px-4 py-2 rounded-full bg-pyramid-50 border border-pyramid-100 text-pyramid-600 text-xs font-medium">
        Under Construction
      </div>
    </div>
  )
}
