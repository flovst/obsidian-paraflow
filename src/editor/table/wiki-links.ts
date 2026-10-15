export interface WikiLinkSource {readonly target:string;readonly alias:string|null;}

/** Table aliases carry an escaped pipe; embeds retain separate unsupported ownership. */
export function decodeWikiSource(source:string):WikiLinkSource {
 if(!source.startsWith('[[')||!source.endsWith(']]'))throw new Error('Expected one complete non-embedded Wiki link');
 const body=source.slice(2,-2),separator=body.indexOf('\\|');
 const link={target:separator<0?body:body.slice(0,separator),alias:separator<0?null:body.slice(separator+2)};
 encodeWikiSource(link);return link;
}

export function encodeWikiSource(link:WikiLinkSource):string {
 if(!link.target.trim()||/[\r\n[\]|\\]/u.test(link.target)||link.alias!==null&&/[\r\n[\]|\\]/u.test(link.alias))throw new Error('Wiki target or alias cannot be expressed losslessly in a table');
 return `[[${link.target}${link.alias===null?'':`\\|${link.alias}`}]]`;
}

export function createWikiAnchor(doc:Document,link:WikiLinkSource):HTMLAnchorElement {
 const anchor=doc.createElement('a');anchor.className='internal-link';anchor.setAttribute('data-href',link.target);anchor.setAttribute('href',link.target);if(link.alias!==null)anchor.setAttribute('data-pf-wiki-alias','true');return anchor;
}

export function isWikiAnchor(element:Element):boolean {return element.localName==='a'&&element.getAttribute('class')==='internal-link'&&element.hasAttribute('data-href');}

/** Only the confirmed host metadata profile may be replaced by source semantics. */
export function readWikiAnchor(element:Element):WikiLinkSource {
 const target=element.getAttribute('data-href')!;
 if(element.getAttribute('href')!==target)throw new Error('Wiki link targets conflict');
 const aliasMarker=element.getAttribute('data-pf-wiki-alias');
 if(aliasMarker!==null&&aliasMarker!=='true')throw new Error('Unknown Wiki alias identity');
 const label=element.textContent??'',alias=aliasMarker==='true'||label!==target?label:null;
 const link={target,alias};encodeWikiSource(link);return link;
}

export function isWikiAttribute(attribute:Attr):boolean {
 if(['class','data-href','href','data-pf-wiki-alias'].includes(attribute.name))return true;
 if(attribute.name==='aria-label')return true;
 return attribute.name==='data-tooltip-position'&&attribute.value==='top'||attribute.name==='target'&&attribute.value==='_blank'||attribute.name==='rel'&&attribute.value==='noopener nofollow';
}
