#!/usr/bin/env sh

PROTECTED_BRANCHES="main master"

is_protected_branch() {
	case " $PROTECTED_BRANCHES " in
		*" $1 "*) return 0 ;;
		*) return 1 ;;
	esac
}

block_protected_branch() {
	echo "Direct $1 to '$2' is blocked. Create a branch and open a pull request." >&2
	echo "  Example: git switch -c feat/<short-topic>" >&2
	exit 1
}
