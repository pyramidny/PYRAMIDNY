// src/pages/Guides.jsx
// Route: /guides
// Index of the staff reference documents. The guides themselves are standalone
// HTML in public/guides/ — they keep their own dark design and are served as
// static files by Vite, so they open in a new tab rather than inside the shell.
//
// WHY NOT REACT PAGES: they were authored as self-contained documents for
// review before the portal existed, and re-authoring them costs more than it
// buys today. If they ever need to live inside the app chrome (search, in-page
// linking, light theme), that is the point to convert them.
//
// joblife and runbook describe parts of the workflow that are not built yet —
// the billing queue, A/R import and the Bids workspace. Each carries a banner
// saying so and badges the affected steps; remove those as the phases ship.
// roadmap.html is the page that says which those are and what comes when, so
// it is listed first and is the only one without the "unbuilt steps" flag.

import { BookOpen, ExternalLink, HardHat, Map, Receipt } from 'lucide-react'

const GUIDES = [
  {
    href: '/guides/roadmap.html',
    icon: Map,
    title: "What's built, and what's coming",
    blurb:
      'Which parts of the portal you can use today, what arrives next, and what each step ' +
      'actually changes about the working day. Read this one first if a step in another guide ' +
      'is marked as not built yet.',
    audience: 'Everyone',
    partial: false,
  },
  {
    href: '/guides/joblife.html',
    icon: HardHat,
    title: 'The life of a job',
    blurb:
      'Start to finish — from a client\'s first call to a paid, closed project. ' +
      'At each step it shows what happens in the portal, in SharePoint and in QuickBooks, ' +
      'and why those are three different places.',
    audience: 'Everyone',
    partial: true,
  },
  {
    href: '/guides/runbook.html',
    icon: Receipt,
    title: 'Billing runbook',
    blurb:
      'From an awarded job to a paid invoice. What to do in QuickBooks when a job is won, ' +
      'how to name it so every invoice matches, and how the portal and QuickBooks stay in step.',
    audience: 'Billing — Noemi, backup Nina',
    partial: true,
  },
]

export default function Guides() {
  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-1">
        <BookOpen size={20} className="text-pyramid-500" />
        <h1 className="text-xl font-condensed font-bold text-ink-800 tracking-wide">
          Guides
        </h1>
      </div>
      <p className="text-sm text-ink-400 mb-6 leading-relaxed">
        How the work is meant to flow. These open in a new tab.
      </p>

      <div className="space-y-3">
        {GUIDES.map(({ href, icon: Icon, title, blurb, audience, partial }) => (
          <a
            key={href}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-pyramid-300 transition-colors group"
          >
            <div className="flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-lg bg-pyramid-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Icon size={17} className="text-pyramid-500" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-semibold text-ink-900 group-hover:text-pyramid-600">
                    {title}
                  </h2>
                  <ExternalLink
                    size={13}
                    className="text-gray-300 group-hover:text-pyramid-400 flex-shrink-0"
                  />
                  {partial && (
                    <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700">
                      Describes unbuilt steps
                    </span>
                  )}
                </div>

                <p className="text-xs text-ink-400 leading-relaxed mt-1.5">{blurb}</p>

                <p className="text-[11px] text-gray-400 mt-2">
                  For: <span className="text-gray-500">{audience}</span>
                </p>
              </div>
            </div>
          </a>
        ))}
      </div>

      <p className="text-[11px] text-gray-400 leading-relaxed mt-6">
        Steps that depend on the billing queue, the A/R import or the Bids workspace are
        badged inside each guide — those parts of the portal are still being built.
      </p>
    </div>
  )
}
