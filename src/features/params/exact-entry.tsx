import {useEffect, useRef, useState, type KeyboardEvent} from 'react';
import {Input} from '@/components/ui/input';
import {cn} from '@/lib/utils';

export type ExactEntryProps = {
	readonly id: string;
	/**
	Accessible name when no visible label points at the input.
	*/
	readonly label?: string;
	readonly value: number;
	readonly format: (value: number) => string;
	readonly parse: (text: string) => number | null;
	readonly onCommit: (value: number) => void;
	readonly inputMode?: 'decimal' | 'numeric';
	readonly className?: string;
};

/**
 A numeric field for exact entry (DESIGN.md section 5.1). Enter and blur
 commit one value; a value the schema cannot parse restores the current one,
 and Escape restores it without committing. Clamping and rounding to the
 parameter's step happen in the store's validation, so the field shows the
 clamped value after the commit.
 */
export function ExactEntry({
	id,
	label,
	value,
	format,
	parse,
	onCommit,
	inputMode = 'decimal',
	className,
}: ExactEntryProps) {
	const [draft, setDraft] = useState<string | null>(null);
	const skipBlurCommitRef = useRef(false);
	const formatted = format(value);

	useEffect(() => {
		setDraft(null);
	}, [formatted]);

	const commit = () => {
		if (draft === null) {
			return;
		}

		const parsed = parse(draft);
		setDraft(null);
		if (parsed !== null) {
			onCommit(parsed);
		}
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		switch (event.key) {
			case 'Enter': {
				event.preventDefault();
				commit();
				break;
			}

			case 'Escape': {
				event.preventDefault();
				skipBlurCommitRef.current = true;
				setDraft(null);
				event.currentTarget.blur();
				break;
			}

			default: {
				break;
			}
		}
	};

	return (
		<Input
			id={id}
			aria-label={label}
			inputMode={inputMode}
			value={draft ?? formatted}
			className={cn('h-8 font-mono text-[13px] tabular-nums', className)}
			onChange={(event) => {
				setDraft(event.target.value);
			}}
			onKeyDown={handleKeyDown}
			onBlur={() => {
				if (skipBlurCommitRef.current) {
					skipBlurCommitRef.current = false;
					return;
				}

				commit();
			}}
		/>
	);
}
