export interface TableMenuItem {
	label: string;
	checked?: 'on' | 'off' | 'mixed';
	disabled?: boolean;
	disabledReason?: string;
	shortcut?: string;
	separatorBefore?: boolean;
	icon?: string;
	children?: readonly TableMenuItem[];
	preview?: () => () => void;
	run?: () => void;
}

export type TableMenuPresenter = (doc:Document,point:{x:number;y:number},items:readonly TableMenuItem[],onClose?:()=>void,renderIcon?:(element:HTMLElement,name:string)=>void)=>{close:()=>void};
