import * as React from 'react';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/utils';

function Sidebar({
  collapsed,
  className,
  ...props
}: React.ComponentProps<'aside'> & { collapsed: boolean }) {
  return (
    <aside
      data-slot="sidebar"
      data-collapsed={collapsed}
      className={cn(
        'group/sidebar relative flex h-svh w-14 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-linear',
        collapsed ? 'md:w-14' : 'md:w-64',
        className,
      )}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-header" className={cn('flex shrink-0 flex-col p-2', className)} {...props} />;
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-content" className={cn('flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden py-1', className)} {...props} />;
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-footer" className={cn('flex shrink-0 flex-col p-2', className)} {...props} />;
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group" className={cn('flex min-w-0 flex-col px-2 py-1.5', className)} {...props} />;
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        'hidden h-7 items-center px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/45 transition-[height,opacity] md:flex md:group-data-[collapsed=true]/sidebar:hidden',
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group-content" className={cn('w-full min-w-0', className)} {...props} />;
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul data-slot="sidebar-menu" className={cn('flex min-w-0 flex-col gap-0.5', className)} {...props} />;
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" className={cn('relative min-w-0', className)} {...props} />;
}

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  size = 'default',
  className,
  ...props
}: React.ComponentProps<'button'> & {
  asChild?: boolean;
  isActive?: boolean;
  size?: 'default' | 'lg';
}) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="sidebar-menu-button"
      data-active={isActive}
      data-size={size}
      className={cn(
        'flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-lg px-2.5 text-left text-sm font-medium text-sidebar-foreground/70 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate',
        size === 'lg' ? 'h-12' : 'h-9',
        'justify-center md:justify-start md:group-data-[collapsed=true]/sidebar:size-9 md:group-data-[collapsed=true]/sidebar:justify-center md:group-data-[collapsed=true]/sidebar:px-0',
        className,
      )}
      {...props}
    />
  );
}

function SidebarRail({ className, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      data-slot="sidebar-rail"
      tabIndex={-1}
      aria-label="Alternar menú lateral"
      title="Alternar menú lateral"
      className={cn(
        'absolute inset-y-0 -right-2 z-20 hidden w-4 cursor-w-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px hover:after:bg-sidebar-border md:block group-data-[collapsed=true]/sidebar:cursor-e-resize',
        className,
      )}
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
};
