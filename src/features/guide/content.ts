/**
 All text of the in-app guide and the empty Library (product.md F2, F27). Edit
 the words here; the screens only lay them out. The effects reference and
 the built-in preset list are generated from the registry and the preset
 module, so they are not written here.

 Shortcut rows must match the key handlers; `content.test.ts` checks them.
 */

export type GuideBlock =
	| {readonly kind: 'paragraph'; readonly text: string}
	| {readonly kind: 'list'; readonly items: readonly string[]}
	| {readonly kind: 'steps'; readonly items: readonly string[]}
	| {
			readonly kind: 'terms';
			readonly items: ReadonlyArray<{
				readonly term: string;
				readonly text: string;
			}>;
	  }
	| {readonly kind: 'shortcuts'}
	| {readonly kind: 'builtinPresets'}
	| {readonly kind: 'effects'};

export type GuideSection = {
	/**
	 Stable id: used for the table of contents and as the heading anchor.
	 */
	readonly id: string;
	readonly title: string;
	/**
	 Left out, with its contents entry, where keyboard hints are hidden
	 (DESIGN.md section 8.4). No other section names a key.
	 */
	readonly keyboardOnly?: boolean;
	readonly blocks: readonly GuideBlock[];
};

export type Shortcut = {
	/**
	 Alternatives, each written the way it is pressed.
	 */
	readonly keys: readonly string[];
	readonly where: string;
	readonly action: string;
};

export const GUIDE_TITLE = 'Drift guide';
export const GUIDE_BUTTON_LABEL = 'Guide';
export const GUIDE_CONTENTS_LABEL = 'Contents';
export const GUIDE_SETTINGS_LINK = 'Read the guide';

export const LANDING = {
	pitch: 'Glitch art and pixel sorting for your photos',
	dropRegionLabel: 'Add photos',
	dropTitle: 'Drop photos here',
	openLabel: 'Open images',
	sampleLabel: 'Try a sample',
	sampleBusyLabel: 'Creating sample…',
	sampleProjectName: 'Sample',
	sampleCreated: 'Created the sample project',
	sampleFailed: "Couldn't create the sample project.",
	guideLabel: 'Read the guide',
	privacy: 'Images stay on this device.',
	offline: 'Drift works offline and needs no account.',
	formats: 'Opens JPEG, PNG, WebP, GIF, BMP, AVIF, TIFF and SVG.',
	introTitle: 'See what Drift does',
	introText:
		'Pick one to try it on a sample picture. Left is the original, right is the result.',
	introDismissLabel: 'Dismiss introduction',
} as const;

export const SHORTCUTS: readonly Shortcut[] = [
	{keys: ['?'], where: 'Anywhere', action: 'Open this guide'},
	{keys: ['Ctrl+Z', '⌘Z'], where: 'Editor', action: 'Undo'},
	{keys: ['Ctrl+Shift+Z', '⇧⌘Z', 'Ctrl+Y'], where: 'Editor', action: 'Redo'},
	{
		keys: ['\\'],
		where: 'Editor',
		action:
			'Tap to switch Compare on or off. Hold to see the original until you let go',
	},
	{keys: ['S'], where: 'Editor', action: 'Switch split view on or off'},
	{
		keys: ['Shift+S'],
		where: 'Editor',
		action:
			'Change the split between left/right and top/bottom, turning split view on',
	},
	{keys: ['+', '='], where: 'Editor', action: 'Zoom in by 2×'},
	{keys: ['-', '_'], where: 'Editor', action: 'Zoom out by 2×'},
	{keys: ['0'], where: 'Editor', action: 'Fit the image to the view'},
	{keys: ['1'], where: 'Editor', action: 'Show the image at 100%'},
	{keys: ['Arrow keys'], where: 'Image canvas', action: 'Pan the image'},
	{
		keys: ['Ctrl+wheel', '⌘+wheel'],
		where: 'Image canvas',
		action: 'Zoom around the pointer',
	},
	{
		keys: ['Arrow keys'],
		where: 'Crop handle',
		action: 'Move that side of the crop box by 1 px. Add Shift for 10 px',
	},
	{
		keys: ['Arrow keys'],
		where: 'Crop box',
		action: 'Move the crop box by 1 px. Add Shift for 10 px',
	},
	{
		keys: ['Enter', 'Escape'],
		where: 'Crop mode',
		action:
			'Apply or cancel the crop. Enter works on the crop box and the image',
	},
	{
		keys: ['Space'],
		where: 'Crop mode',
		action: 'Hold while dragging to pan instead of moving the crop box',
	},
	{
		keys: ['Left', 'Right'],
		where: 'Left/right split divider',
		action: 'Move the divider by 1%. Add Shift for 10%',
	},
	{
		keys: ['Up', 'Down'],
		where: 'Top/bottom split divider',
		action: 'Move the divider by 1%. Add Shift for 10%',
	},
	{
		keys: ['Home', 'End'],
		where: 'Split divider',
		action: 'Move the divider to one edge or the other',
	},
	{
		keys: ['Arrow keys'],
		where: 'Slider',
		action: 'Change the value by one step. Add Shift for ten steps',
	},
	{
		keys: ['Home', 'End'],
		where: 'Slider',
		action: 'Set the smallest or largest value',
	},
	{
		keys: ['Arrow keys'],
		where: 'Angle dial',
		action: 'Turn by 1°. Add Shift for 15°',
	},
	{
		keys: ['Page Up', 'Page Down'],
		where: 'Angle dial',
		action: 'Turn by 15°',
	},
	{
		keys: ['Home', 'End'],
		where: 'Angle dial',
		action: 'Set 0° or 359.9°',
	},
	{
		keys: ['Enter', 'Escape'],
		where: 'Number field',
		action: 'Apply or cancel what you typed',
	},
	{
		keys: ['Alt+Up', 'Alt+Down'],
		where: 'Effect in the stack',
		action: 'Move the effect up or down',
	},
	{
		keys: ['Up', 'Down'],
		where: 'Panel handle (tablet and phone widths)',
		action: 'Resize the bottom panel',
	},
	{
		keys: ['Escape'],
		where: 'History compare',
		action: 'Stop comparing against the pinned history step',
	},
	{
		keys: ['Escape'],
		where: 'Dialog or menu',
		action: 'Close it',
	},
];

export const GUIDE_SECTIONS: readonly GuideSection[] = [
	{
		id: 'about',
		title: 'What Drift is',
		blocks: [
			{
				kind: 'paragraph',
				text: 'Drift is an editor for pixel sorting and glitch effects on still photos. It runs in your browser.',
			},
			{
				kind: 'list',
				items: [
					'It works offline once it has loaded for the first time.',
					'Your photos stay on this device. Nothing is uploaded and there is no account.',
					'Projects are saved automatically in browser storage. Close the tab and your work is there when you come back.',
					'Your original photo is never changed. Effects are applied on top of it.',
				],
			},
		],
	},
	{
		id: 'quick-start',
		title: 'Quick start',
		blocks: [
			{
				kind: 'steps',
				items: [
					'Import: choose “Import images” or drag files onto the window. Each photo becomes a project in the Library. With no projects yet, “Try a sample” makes one from a built-in picture.',
					'Add effects: choose “Add effect” in the editor, or apply a preset from the toolbar.',
					'Tweak: select an effect and move its controls. The preview updates as you drag and sharpens when you stop. A phone held upright shows one control at a time: pick it in the row above, or choose “Show all controls”.',
					'Compare: use Compare to see the original, or split view to put two looks beside each other.',
					'Export: choose “Export”, pick a format and size, and download the file.',
					'Keep the project: choose “Save project file” to download it, effects and all, as a .glproj file.',
				],
			},
			{
				kind: 'paragraph',
				text: 'Drift opens JPEG, PNG, WebP, GIF, BMP and AVIF files, as far as your browser can decode them. An SVG becomes a still image, and links to outside files in it are not loaded. An animated image imports its first frame. HEIC/HEIF and camera RAW files are not supported: convert them first. Files over 200 MB or over 16,384 px on the longest side are refused. Above 50 megapixels you can import at 50 megapixels or import the full size.',
			},
		],
	},
	{
		id: 'effects-stack',
		title: 'The effect stack',
		blocks: [
			{
				kind: 'paragraph',
				text: 'The effects of a project form a list, applied from top to bottom. Each effect works on the result of the one above it. A project holds up to 32 effects.',
			},
			{
				kind: 'list',
				items: [
					'Switch an effect off to see the image without it. It keeps its settings. On a phone, tap the effect first: its switch and menu appear on it.',
					'Reorder with the effect’s menu, or by dragging on wider screens.',
					'Duplicate or remove an effect from its menu.',
					'Mix sets how strongly an effect shows. Blend chooses how it combines with the image below: Normal, Lighten, Darken or Difference.',
					'Reset one control or “Reset all”. “Randomize” gives every control a random value so you can explore.',
				],
			},
			{
				kind: 'paragraph',
				text: 'The “Image blend” effect mixes another picture into your photo. Effects above it change your photo only; effects below it change the blended result. Add it again to mix in a third picture.',
			},
			{
				kind: 'list',
				items: [
					'Add “Image blend”, then “Choose image”. “From device” opens a file under the same rules as an import, without adding a project to the Library.',
					'“From library” takes the original photo of another project, without its crop or effects. The picture is stored only once.',
					'Set Blend mode and Opacity, then place the picture with Fit, Scale, Offset X, Offset Y and Rotation. Until you choose a picture, the effect changes nothing.',
					'“Clear” removes the picture, and Undo brings it back. “Randomize” keeps it.',
					'A project can use up to 8 extra pictures. Project files carry them along. A preset saves the settings but not the picture.',
				],
			},
		],
	},
	{
		id: 'geometry',
		title: 'Crop, rotate and resize',
		blocks: [
			{
				kind: 'paragraph',
				text: 'Choose “Transform” in the editor toolbar. These changes happen before the effects, never alter your original photo, and each one is a step you can undo.',
			},
			{
				kind: 'list',
				items: [
					'Rotate by 90° either way or flip horizontally or vertically. Each press saves at once, and the crop turns with the image.',
					'Crop: drag the handles, drag inside the box to move it, choose an aspect ratio, or type X, Y, Width and Height in pixels. “Apply crop” saves it and “Cancel” drops it.',
					'While cropping you see the whole photo without effects, and Compare and split view pause until you finish. Use “Edit crop” to start again, or “Reset crop” to get the full photo back.',
					'Resize in pixels or percent, from 1% to 1000%. The lock keeps the proportions. Choose Lanczos-3 for smooth detail, Bilinear for a softer result, or Nearest for hard pixel edges. Press “Apply resize”.',
					'The largest output is 16,384 px per side and 50 megapixels. A photo imported above 50 megapixels can be made smaller but not larger.',
					'A crop of a new size removes the resize, so set the size after cropping. Applying a preset keeps your crop, rotation, flips and size.',
					'Effect sizes given in px apply to the cropped and resized image.',
				],
			},
		],
	},
	{
		id: 'effects-reference',
		title: 'Effects reference',
		blocks: [
			{
				kind: 'paragraph',
				text: 'Every effect in this version, with each control’s range and starting value. Sizes in px are measured on the original photo.',
			},
			{kind: 'effects'},
		],
	},
	{
		id: 'concepts',
		title: 'Pixel sort concepts',
		blocks: [
			{
				kind: 'paragraph',
				text: 'Pixel sort rearranges pixels along straight paths. These words appear in its controls.',
			},
			{
				kind: 'terms',
				items: [
					{
						term: 'Angle',
						text: 'The direction pixels are sorted in. 0° sorts left to right, 90° bottom to top, 180° right to left and 270° top to bottom. Pixels move; they are never blurred.',
					},
					{
						term: 'Line',
						text: 'One straight path of pixels across the image, along the angle.',
					},
					{
						term: 'Selection',
						text: 'Which pixels may move. Choose a threshold range on a key, the areas between edges, or whole lines. “Show selection” darkens the pixels that stay put.',
					},
					{
						term: 'Run',
						text: 'A stretch of selected pixels next to each other in a line. An unselected pixel ends it, so edges stay sharp there.',
					},
					{
						term: 'Interval',
						text: 'A run, or a piece of a run when the maximum interval length splits it. Each interval is sorted on its own.',
					},
					{
						term: 'Sort key',
						text: 'The number taken from each pixel that decides its order, such as brightness (luma), hue, saturation or one colour channel.',
					},
					{
						term: 'Mask',
						text: 'A map that limits where an effect applies. Painted masks are not in the app yet. For now, use the selection controls to limit where pixels move.',
					},
				],
			},
		],
	},
	{
		id: 'presets',
		title: 'Presets',
		blocks: [
			{
				kind: 'paragraph',
				text: 'A preset is a saved effect stack you can apply to any photo. Open “Presets” in the editor toolbar.',
			},
			{
				kind: 'list',
				items: [
					'Applying a preset replaces the current effects. Drift asks first when there are effects to replace, and you can undo it.',
					'“Add to stack” keeps your effects and adds the preset’s effects after them.',
					'“Save as preset” stores your current stack under a name. You can rename or delete your own presets.',
					'In split view, presets act on the side you are editing.',
				],
			},
			{kind: 'paragraph', text: 'Built-in presets:'},
			{kind: 'builtinPresets'},
		],
	},
	{
		id: 'history',
		title: 'Undo and history',
		blocks: [
			{
				kind: 'paragraph',
				text: 'Every finished change, such as releasing a slider or adding an effect, is one step, named after what changed. Use the Undo and Redo buttons. Making a new change after undoing drops the steps you undid.',
			},
			{
				kind: 'paragraph',
				text: 'Each project keeps up to 200 steps, and they are still there after you reload. One history covers both sides of the split view, and those steps name their side. Undo does not change zoom, pan or theme.',
			},
			{
				kind: 'paragraph',
				text: 'Use “Compare with this” on any step in the History panel to compare that snapshot against your current edit in split view or with Compare, without changing your history or effect stacks. Use the close button on the canvas label to stop comparing.',
			},
		],
	},
	{
		id: 'compare',
		title: 'Compare and split view',
		blocks: [
			{
				kind: 'list',
				items: [
					'Click Compare to show the original, and click again for your result.',
					'Press and hold Compare to peek at the original and release to return.',
					'Split view shows side A on the left and side B on the right. The turn button puts A on top and B below instead. It sits beside “Split”, or on a phone beside the side buttons.',
					'Each side has its own effects. Side B is your main effect stack. Side A starts empty, so it shows the original until you add effects to it.',
					'In split view, choose the side under “Editing” in the effects panel. “Copy to other side” and “Swap sides” sit beside it.',
					'Drag the divider to compare more of one side.',
					'Zoom by pinching or with the zoom menu. Double-tap or double-click switches between Fit and 100%.',
				],
			},
		],
	},
	{
		id: 'export',
		title: 'Export',
		blocks: [
			{
				kind: 'list',
				items: [
					'Formats: PNG, JPEG, WebP where your browser can write it, AVIF, BMP and TIFF.',
					'Quality (JPEG, WebP and AVIF) goes from 50 to 100. It starts at 92, or 80 for AVIF.',
					'AVIF makes small files, but a large photo takes longer to export than in other formats.',
					'Size: full, half, quarter, or a custom longest side. Drift never scales a photo up.',
					'Name the file, then download it. A Share button appears where your browser supports sharing files.',
					'Export saves side B. When side A of the split view has effects, you can choose side A instead.',
					'Exported files carry no camera, location or colour profile data. JPEG has no transparency, so transparent areas become white.',
				],
			},
			{
				kind: 'paragraph',
				text: 'File-size limit (off at first): pick a preset or type a limit from 10 KB to 100 MB. JPEG, WebP and AVIF lower the quality first, then shrink the image. PNG, BMP and TIFF can only shrink the image. Drift tells you the final size and what it changed, and says so if even the smallest image is over the limit.',
			},
		],
	},
	{
		id: 'shortcuts',
		title: 'Keyboard shortcuts',
		keyboardOnly: true,
		blocks: [
			{
				kind: 'paragraph',
				text: 'Editor shortcuts are off while you type in a text field.',
			},
			{kind: 'shortcuts'},
		],
	},
	{
		id: 'storage',
		title: 'Storage and privacy',
		blocks: [
			{
				kind: 'list',
				items: [
					'Photos and projects are kept in this browser’s storage on this device. Drift sends nothing anywhere and has no analytics.',
					'The browser sets a storage limit. Settings shows how much you use. If space runs out, delete projects you no longer need.',
					'In Settings, “Request protection” asks the browser not to clear your data when disk space is low.',
					'Private browsing windows delete everything when you close them.',
					'Clearing your browser data deletes your projects. Export a backup, or save the ones you want to keep as project files.',
				],
			},
		],
	},
	{
		id: 'project-files',
		title: 'Project files',
		blocks: [
			{
				kind: 'paragraph',
				text: 'A project file (.glproj) holds one whole project: the original photo, crop and size, effects, export settings and, if you keep it, the undo history. Saving and opening happen on this device and nothing is uploaded.',
			},
			{
				kind: 'list',
				items: [
					'Save: choose “Save project file” in the menu of a Library project, or in the editor. On a phone it is in the menu at the top right of the editor.',
					'Leave “Include undo history” checked to keep your steps. Without it the file opens with a single starting step.',
					'Open: choose “Import images” or “Open images” and pick the file, or drop it on the window.',
					'Opening a file always adds a new project and never replaces one. A name that is already taken gets “(imported)” added.',
					'A project made with effects this version does not have still opens. Those effects are kept and skipped, and a message says how many.',
				],
			},
		],
	},
	{
		id: 'backups',
		title: 'Backup and restore',
		blocks: [
			{
				kind: 'paragraph',
				text: 'A backup is one ZIP file holding the projects you choose and, if you keep them ticked, their undo history, your own presets and your settings. It is made and read on this device and nothing is uploaded.',
			},
			{
				kind: 'list',
				items: [
					'Export: choose “Export backup” in Settings under Storage, or in the menu at the top right of the Library. On a phone it is in the editor’s top right menu too.',
					'Import: choose “Import backup” in the same places and pick the file. A backup also opens when you drop it on the window or pick it with “Import images” or “Open images”. Drift shows what it holds and writes nothing until you choose “Import”.',
					'Merge keeps what you have. A project that has not changed is skipped, and one you changed since the backup is added as a copy with “(imported)” in its name.',
					'Replace first deletes every project and user preset on this device, after asking. It then imports what you ticked.',
					'One backup holds up to 4 GB. If yours is larger, export fewer projects or leave out undo history.',
				],
			},
		],
	},
	{
		id: 'offline',
		title: 'Install and offline use',
		blocks: [
			{
				kind: 'list',
				items: [
					'After the first visit Drift loads and works without a connection, including this guide.',
					'To install it as an app, choose “Install app” in Settings when your browser offers it, or use your browser’s install menu.',
					'When a new version is ready, a message offers “Reload to update”. Drift never reloads on its own.',
				],
			},
		],
	},
];
