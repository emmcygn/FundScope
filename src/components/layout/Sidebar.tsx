'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  LayoutDashboard,
  Shield,
  LogOut,
  Moon,
  Sun,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { useTheme } from 'next-themes'

interface SidebarProps {
  userName?: string | null
}

const NAV_ITEMS = [
  { href: '/', label: 'Funds', icon: LayoutDashboard },
]

export function Sidebar({ userName }: SidebarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const [expanded, setExpanded] = useState(false)

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    toast.success('Logged out')
    router.push('/login')
    router.refresh()
  }

  return (
    <TooltipProvider delay={0}>
      <div
        className={cn(
          'flex h-full flex-col border-r bg-sidebar transition-[width] duration-200 overflow-hidden',
          expanded ? 'w-60' : 'w-16'
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-4 min-h-14">
          <Shield className="h-6 w-6 text-primary shrink-0" />
          {expanded && (
            <span className="heading-serif text-lg font-bold tracking-tight whitespace-nowrap">
              FundScope
            </span>
          )}
        </div>

        <Separator />

        {/* Navigation */}
        <nav className="flex-1 px-2 py-2 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href

            const navButton = (
              <button
                onClick={() => router.push(item.href)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  expanded ? '' : 'justify-center px-0',
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {expanded && <span className="whitespace-nowrap">{item.label}</span>}
              </button>
            )

            if (expanded) return <div key={item.href}>{navButton}</div>

            return (
              <Tooltip key={item.href}>
                <TooltipTrigger
                  className="w-full"
                  render={navButton}
                />
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            )
          })}
        </nav>

        <Separator />

        {/* Footer */}
        <div className="p-2 space-y-1">
          {expanded && userName && (
            <p className="text-xs text-muted-foreground truncate px-2 py-1">
              {userName}
            </p>
          )}

          {/* Theme toggle */}
          {expanded ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? (
                <Sun className="h-3.5 w-3.5 mr-1.5" />
              ) : (
                <Moon className="h-3.5 w-3.5 mr-1.5" />
              )}
              {theme === 'dark' ? 'Light' : 'Dark'}
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger
                className="w-full"
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-full"
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  >
                    {theme === 'dark' ? (
                      <Sun className="h-4 w-4" />
                    ) : (
                      <Moon className="h-4 w-4" />
                    )}
                  </Button>
                }
              />
              <TooltipContent side="right">
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Logout */}
          {expanded ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs text-muted-foreground"
              onClick={handleLogout}
            >
              <LogOut className="h-3.5 w-3.5 mr-1.5" />
              Sign out
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger
                className="w-full"
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-full text-muted-foreground"
                    onClick={handleLogout}
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                }
              />
              <TooltipContent side="right">Sign out</TooltipContent>
            </Tooltip>
          )}

          {/* Expand/collapse toggle */}
          <Tooltip>
            <TooltipTrigger
              className="w-full"
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-full"
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? (
                    <PanelLeftClose className="h-4 w-4" />
                  ) : (
                    <PanelLeftOpen className="h-4 w-4" />
                  )}
                </Button>
              }
            />
            <TooltipContent side="right">
              {expanded ? 'Collapse sidebar' : 'Expand sidebar'}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}
