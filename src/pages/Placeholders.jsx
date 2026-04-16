import { Construction } from 'lucide-react'

// -- Team -----------------------------------------------
export function Team() {
    return <Placeholder title="Team" description="User directory, role assignments, and division access management." />
}

// -- Shared placeholder ---------------------------------
function Placeholder({ title, description }) {
    return (
          <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-pyramid-50 flex items-center justify-center mb-5">
                        <Construction size={28} className="text-pyramid-500" />
                </div>div>
                <h2 className="text-xl font-condensed font-bold text-ink-800 tracking-wide mb-2">
                  {title}
                </h2>h2>
                <p className="text-ink-400 text-sm max-w-xs leading-relaxed">{description}</p>p>
                <div className="mt-6 px-4 py-2 rounded-full bg-pyramid-50 border border-pyramid-100 text-pyramid-600 text-xs font-medium">
                        Under Construction
                </div>div>
          </div>div>
        )
}</div>
