import {useState} from 'react';
import {
	CheckIcon,
	EyeOffIcon,
	MoreHorizontalIcon,
	PlusIcon,
	RotateCcwIcon,
	SlidersHorizontalIcon,
	Trash2Icon,
} from 'lucide-react';
import {toast} from 'sonner';
import {ThemeSelector, ThemeToggle} from '@/components/theme-toggle';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from '@/components/ui/popover';
import {Progress} from '@/components/ui/progress';
import {ScrollArea} from '@/components/ui/scroll-area';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import {Separator} from '@/components/ui/separator';
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from '@/components/ui/sheet';
import {Slider} from '@/components/ui/slider';
import {Switch} from '@/components/ui/switch';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';

const TOKEN_SWATCHES = [
	{name: '--background', className: 'bg-background'},
	{name: '--canvas-stage', className: 'bg-canvas-stage'},
	{name: '--card', className: 'bg-card'},
	{name: '--popover', className: 'bg-popover'},
	{name: '--secondary', className: 'bg-secondary'},
	{name: '--muted', className: 'bg-muted'},
	{name: '--primary', className: 'bg-primary'},
	{name: '--accent', className: 'bg-accent'},
	{name: '--destructive', className: 'bg-destructive'},
	{name: '--warning', className: 'bg-warning'},
	{name: '--success', className: 'bg-success'},
] as const;

const SORT_KEYS = [
	'Luminance',
	'Hue',
	'Saturation',
	'Brightness',
	'Red',
	'Green',
	'Blue',
	'Alpha',
] as const;

const SCROLL_PARAMS = [
	{name: 'Angle', value: '45.0°'},
	{name: 'Interval mode', value: 'Threshold'},
	{name: 'Selection key', value: 'Luminance'},
	{name: 'Low threshold', value: '0.25'},
	{name: 'High threshold', value: '0.75'},
	{name: 'Max interval', value: '240 px'},
	{name: 'Length jitter', value: '15%'},
	{name: 'Skip chance', value: '0%'},
	{name: 'Sort key', value: 'Luminance'},
	{name: 'Order', value: 'Ascending'},
	{name: 'Fill mode', value: 'Sort'},
] as const;

function SectionHeading({children}: {readonly children: string}) {
	return (
		<h2 className="text-[11px] leading-4 font-semibold tracking-[0.05em] text-muted-foreground uppercase">
			{children}
		</h2>
	);
}

export function ComponentGallery() {
	const [mix, setMix] = useState([75]);
	const [threshold, setThreshold] = useState([25, 75]);
	const [showSelection, setShowSelection] = useState(true);
	const [invertSelection, setInvertSelection] = useState(false);
	const [blend, setBlend] = useState('normal');
	const [sortKey, setSortKey] = useState('Luminance');
	const [angleValue, setAngleValue] = useState('45.0');
	const [filename, setFilename] = useState('sunset-20261124-160000.png');
	const [invalidLongestSide, setInvalidLongestSide] = useState('24000');

	return (
		<ScrollArea
			className="h-dvh bg-background text-foreground"
			viewportClassName="[&>div]:block!"
		>
			<header className="sticky top-0 z-30 flex h-[52px] items-center justify-between gap-2 border-b border-border bg-background px-3 sm:px-4 lg:h-12 lg:px-6">
				<div className="flex min-w-0 items-center gap-2">
					<h1 className="truncate text-lg leading-6 font-semibold">
						PixelSortGUI
					</h1>
					<Badge variant="outline" className="hidden sm:inline-flex">
						Gallery
					</Badge>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<div className="hidden sm:block">
						<ThemeSelector />
					</div>
					<ThemeToggle />
				</div>
			</header>

			<main className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 p-3 sm:p-4 lg:p-6">
				<section aria-label="Theme and surface tokens" className="space-y-2">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<SectionHeading>Surface &amp; Semantic Tokens</SectionHeading>
						<div className="sm:hidden">
							<ThemeSelector />
						</div>
					</div>
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
						{TOKEN_SWATCHES.map((swatch) => (
							<div
								key={swatch.name}
								className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-card p-2"
							>
								<span
									className={`size-5 shrink-0 rounded-sm border border-input ${swatch.className}`}
									aria-hidden="true"
								/>
								<span className="truncate font-mono text-xs text-foreground">
									{swatch.name}
								</span>
							</div>
						))}
						<div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-card p-2">
							<span
								className="bg-checkerboard size-5 shrink-0 rounded-sm border border-input"
								aria-hidden="true"
							/>
							<span className="truncate font-mono text-xs text-foreground">
								--checker
							</span>
						</div>
					</div>
				</section>

				<Separator />

				<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
					<Card className="min-w-0">
						<CardHeader>
							<SectionHeading>Buttons &amp; Badges</SectionHeading>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="flex flex-wrap items-center gap-2">
								<Button type="button">Export</Button>
								<Button type="button" variant="secondary">
									Compare
								</Button>
								<Button type="button" variant="outline">
									Split
								</Button>
								<Button type="button" variant="ghost">
									Reset all
								</Button>
								<Button type="button" variant="destructive">
									Delete
								</Button>
								<Button type="button" variant="link">
									Notices
								</Button>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<Button type="button" size="sm">
									Small
								</Button>
								<Button disabled type="button">
									Disabled
								</Button>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											type="button"
											variant="outline"
											size="icon-sm"
											aria-label="Reset angle"
										>
											<RotateCcwIcon aria-hidden="true" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Reset to default</TooltipContent>
								</Tooltip>
							</div>
							<Separator />
							<div className="flex flex-wrap items-center gap-2">
								<Badge>Original</Badge>
								<Badge variant="secondary">100%</Badge>
								<Badge variant="outline">
									<EyeOffIcon aria-hidden="true" />
									Off
								</Badge>
								<Badge variant="destructive">Error</Badge>
								<Badge variant="outline" className="text-success">
									<CheckIcon aria-hidden="true" />
									Persistent
								</Badge>
							</div>
						</CardContent>
					</Card>

					<Card className="min-w-0">
						<CardHeader>
							<SectionHeading>Inputs &amp; Validation</SectionHeading>
						</CardHeader>
						<CardContent className="space-y-3">
							<div className="space-y-1.5">
								<Label htmlFor="gallery-filename">Filename</Label>
								<Input
									id="gallery-filename"
									value={filename}
									onChange={(event) => {
										setFilename(event.target.value);
									}}
								/>
							</div>
							<div className="grid grid-cols-2 gap-2">
								<div className="space-y-1.5">
									<Label htmlFor="gallery-angle">Angle (°)</Label>
									<Input
										id="gallery-angle"
										inputMode="decimal"
										className="font-mono tabular-nums"
										value={angleValue}
										onChange={(event) => {
											setAngleValue(event.target.value);
										}}
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="gallery-disabled">Seed</Label>
									<Input
										disabled
										id="gallery-disabled"
										className="font-mono tabular-nums"
										defaultValue="104729"
									/>
								</div>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="gallery-error">Longest side (px)</Label>
								<Input
									id="gallery-error"
									aria-invalid="true"
									aria-describedby="gallery-error-msg"
									inputMode="numeric"
									className="font-mono tabular-nums"
									value={invalidLongestSide}
									onChange={(event) => {
										setInvalidLongestSide(event.target.value);
									}}
								/>
								<p
									id="gallery-error-msg"
									className="text-xs text-destructive-text"
								>
									Limit is 16,384 px.
								</p>
							</div>
						</CardContent>
					</Card>

					<Card className="min-w-0">
						<CardHeader>
							<SectionHeading>Sliders, Switches &amp; Progress</SectionHeading>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<div className="flex items-center justify-between text-sm">
									<span id="mix-slider-label" className="font-medium">
										Mix
									</span>
									<span className="font-mono text-xs text-muted-foreground tabular-nums">
										{mix[0]}%
									</span>
								</div>
								<Slider
									value={mix}
									min={0}
									max={100}
									step={1}
									thumbLabels={['Mix']}
									onValueChange={setMix}
								/>
							</div>
							<div className="space-y-2">
								<div className="flex items-center justify-between text-sm">
									<span className="font-medium">Threshold range</span>
									<span className="font-mono text-xs text-muted-foreground tabular-nums">
										{(threshold[0] / 100).toFixed(2)} –{' '}
										{(threshold[1] / 100).toFixed(2)}
									</span>
								</div>
								<Slider
									value={threshold}
									min={0}
									max={100}
									step={1}
									minStepsBetweenThumbs={0}
									thumbLabels={['Low threshold', 'High threshold']}
									onValueChange={setThreshold}
								/>
							</div>
							<div className="space-y-2">
								<div className="flex items-center justify-between text-sm">
									<span className="text-muted-foreground">Disabled slider</span>
									<span className="font-mono text-xs text-muted-foreground tabular-nums">
										50%
									</span>
								</div>
								<Slider
									disabled
									defaultValue={[50]}
									min={0}
									max={100}
									thumbLabels={['Disabled slider']}
								/>
							</div>
							<Separator />
							<div className="space-y-2.5">
								<div className="flex items-center justify-between gap-2">
									<Label htmlFor="switch-selection">Show selection</Label>
									<Switch
										id="switch-selection"
										checked={showSelection}
										onCheckedChange={setShowSelection}
									/>
								</div>
								<div className="flex items-center justify-between gap-2">
									<Label htmlFor="switch-invert">Invert mask</Label>
									<Switch
										id="switch-invert"
										checked={invertSelection}
										onCheckedChange={setInvertSelection}
									/>
								</div>
								<div className="flex items-center justify-between gap-2">
									<Label htmlFor="switch-disabled">Disabled switch</Label>
									<Switch disabled id="switch-disabled" />
								</div>
							</div>
							<Separator />
							<div className="space-y-1.5">
								<div className="flex items-center justify-between text-xs text-muted-foreground">
									<span>Encoding PNG</span>
									<span className="font-mono tabular-nums">64%</span>
								</div>
								<Progress value={64} aria-label="Export progress" />
							</div>
						</CardContent>
					</Card>

					<Card className="min-w-0">
						<CardHeader>
							<SectionHeading>Selection &amp; Tabs</SectionHeading>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-1.5">
								<span className="text-sm font-medium">Blend mode</span>
								<ToggleGroup
									type="single"
									variant="outline"
									size="sm"
									value={blend}
									aria-label="Blend mode"
									className="flex-wrap"
									onValueChange={(value) => {
										if (value) {
											setBlend(value);
										}
									}}
								>
									<ToggleGroupItem value="normal">Normal</ToggleGroupItem>
									<ToggleGroupItem value="lighten">Lighten</ToggleGroupItem>
									<ToggleGroupItem value="darken">Darken</ToggleGroupItem>
									<ToggleGroupItem value="difference">
										Difference
									</ToggleGroupItem>
								</ToggleGroup>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="gallery-sort-key">Sort key</Label>
								<Select value={sortKey} onValueChange={setSortKey}>
									<SelectTrigger id="gallery-sort-key" className="w-full">
										<SelectValue placeholder="Choose sort key" />
									</SelectTrigger>
									<SelectContent>
										{SORT_KEYS.map((key) => (
											<SelectItem key={key} value={key}>
												{key}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<Separator />
							<Tabs defaultValue="stack">
								<TabsList className="w-full">
									<TabsTrigger value="stack">Stack</TabsTrigger>
									<TabsTrigger value="presets">Presets</TabsTrigger>
								</TabsList>
								<TabsContent value="stack" className="pt-2">
									<div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
										<span>Pixel sort</span>
										<Badge variant="outline">Active</Badge>
									</div>
								</TabsContent>
								<TabsContent value="presets" className="pt-2">
									<div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
										<span>ASDF classic</span>
										<span className="text-xs text-muted-foreground">
											Built-in
										</span>
									</div>
								</TabsContent>
							</Tabs>
						</CardContent>
					</Card>

					<Card className="min-w-0">
						<CardHeader>
							<SectionHeading>Overlays, Menus &amp; Toast</SectionHeading>
						</CardHeader>
						<CardContent className="flex flex-wrap gap-2">
							<Dialog>
								<DialogTrigger asChild>
									<Button type="button" variant="outline">
										Open dialog
									</Button>
								</DialogTrigger>
								<DialogContent>
									<DialogHeader>
										<DialogTitle>Export image</DialogTitle>
										<DialogDescription>
											Full resolution 4032 × 3024 px PNG without EXIF metadata.
										</DialogDescription>
									</DialogHeader>
									<div className="space-y-2 py-2">
										<Label htmlFor="dialog-filename">Output name</Label>
										<Input
											id="dialog-filename"
											defaultValue="sunset-20261124.png"
										/>
									</div>
									<DialogFooter>
										<DialogClose asChild>
											<Button type="button" variant="outline">
												Cancel
											</Button>
										</DialogClose>
										<DialogClose asChild>
											<Button type="button">Download</Button>
										</DialogClose>
									</DialogFooter>
								</DialogContent>
							</Dialog>

							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button type="button" variant="destructive">
										Alert dialog
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>Delete sunset?</AlertDialogTitle>
										<AlertDialogDescription>
											This removes the project and unreferenced source bytes
											from this device.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Cancel</AlertDialogCancel>
										<AlertDialogAction variant="destructive">
											Delete
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>

							<Sheet>
								<SheetTrigger asChild>
									<Button type="button" variant="outline">
										<SlidersHorizontalIcon aria-hidden="true" />
										Open sheet
									</Button>
								</SheetTrigger>
								<SheetContent side="right">
									<SheetHeader>
										<SheetTitle>Pixel sort</SheetTitle>
										<SheetDescription>
											Parameter drawer layout for compact viewports.
										</SheetDescription>
									</SheetHeader>
									<div className="flex flex-col gap-1 px-4 text-sm text-muted-foreground">
										<span>Angle 45.0°</span>
										<span>Threshold 0.25–0.75</span>
									</div>
									<SheetFooter>
										<SheetClose asChild>
											<Button type="button" variant="outline">
												Done
											</Button>
										</SheetClose>
									</SheetFooter>
								</SheetContent>
							</Sheet>

							<Popover>
								<PopoverTrigger asChild>
									<Button type="button" variant="outline">
										<PlusIcon aria-hidden="true" />
										Add effect
									</Button>
								</PopoverTrigger>
								<PopoverContent align="start">
									<PopoverHeader>
										<PopoverTitle>Effects</PopoverTitle>
										<PopoverDescription>
											Append an effect to the stack.
										</PopoverDescription>
									</PopoverHeader>
									<div className="mt-3 flex flex-col gap-1">
										<Button
											type="button"
											variant="ghost"
											className="justify-start"
										>
											Pixel sort
										</Button>
										<Button
											type="button"
											variant="ghost"
											className="justify-start"
										>
											Channel shift
										</Button>
									</div>
								</PopoverContent>
							</Popover>

							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button type="button" variant="outline">
										<MoreHorizontalIcon aria-hidden="true" />
										Menu
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="start">
									<DropdownMenuLabel>Instance actions</DropdownMenuLabel>
									<DropdownMenuItem>
										Move up
										<DropdownMenuShortcut>Alt+↑</DropdownMenuShortcut>
									</DropdownMenuItem>
									<DropdownMenuItem>
										Move down
										<DropdownMenuShortcut>Alt+↓</DropdownMenuShortcut>
									</DropdownMenuItem>
									<DropdownMenuItem>Duplicate</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem variant="destructive">
										<Trash2Icon aria-hidden="true" />
										Remove
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>

							<Button
								type="button"
								variant="secondary"
								onClick={() => {
									toast('Export finished: sunset.png');
								}}
							>
								Show toast
							</Button>
						</CardContent>
					</Card>

					<Card className="min-w-0">
						<CardHeader>
							<SectionHeading>Project Card &amp; ScrollArea</SectionHeading>
						</CardHeader>
						<CardContent className="space-y-3">
							<div className="overflow-hidden rounded-md border border-border bg-background">
								<div className="bg-checkerboard flex aspect-4/3 items-end justify-between p-2">
									<Badge>Original</Badge>
									<Badge variant="secondary" className="font-mono tabular-nums">
										100%
									</Badge>
								</div>
								<div className="flex items-center justify-between gap-2 p-2.5">
									<div className="min-w-0">
										<CardTitle className="truncate">sunset</CardTitle>
										<CardDescription className="font-mono tabular-nums">
											4032 × 3024 px
										</CardDescription>
										<CardDescription>Today</CardDescription>
									</div>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										aria-label="Project options for sunset"
									>
										<MoreHorizontalIcon aria-hidden="true" />
									</Button>
								</div>
							</div>
							<ScrollArea className="h-28 rounded-md border border-border bg-background p-2">
								<ul className="space-y-1.5 text-xs">
									{SCROLL_PARAMS.map((param) => (
										<li
											key={param.name}
											className="flex items-center justify-between gap-2"
										>
											<span className="text-muted-foreground">
												{param.name}
											</span>
											<span className="font-mono text-foreground tabular-nums">
												{param.value}
											</span>
										</li>
									))}
								</ul>
							</ScrollArea>
						</CardContent>
						<CardFooter className="justify-between border-t border-border text-xs text-muted-foreground">
							<span>Images stay on this device.</span>
							<span className="font-mono">#/dev/gallery</span>
						</CardFooter>
					</Card>
				</div>
			</main>
		</ScrollArea>
	);
}
