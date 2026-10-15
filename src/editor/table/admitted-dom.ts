/** Callers only pass HTML already admitted by the strict table serializer. */
export function admittedFragment(owner:Document,html:string):DocumentFragment {
	const parsed=new owner.defaultView!.DOMParser().parseFromString(html,'text/html');
	const fragment=owner.createDocumentFragment();
	for(const child of Array.from(parsed.body.childNodes))fragment.append(owner.importNode(child,true));
	return fragment;
}
