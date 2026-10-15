import {validateDimensions} from './toolbar-source';

export function showTableSizePopup(doc:Document,point:{x:number;y:number},initial:{rows:number;columns:number},apply:(rows:number,columns:number)=>void,onClose:()=>void):{close:()=>void;dom:HTMLElement} {
	const root=doc.createElement('form');root.className='paraflow-table-size-popup';root.setAttribute('role','dialog');root.setAttribute('aria-label','调整表格行列数');
	root.style.left=`${point.x}px`;root.style.top=`${point.y}px`;let closed=false;
	const close=()=>{if(closed)return;closed=true;root.remove();doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('keydown',key,true);onClose();};
	const outside=(event:Event)=>{if(!root.contains(event.target as Node))close();};
	const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}};
	const inputs=doc.createElement('div');inputs.className='paraflow-table-size-inputs';
	const input=(label:string,value:number)=>{const wrapper=doc.createElement('label');wrapper.textContent=label;const element=doc.createElement('input');element.type='number';element.required=true;element.min='0';element.max='10000';element.step='1';element.value=String(value);element.setAttribute('aria-label',label);wrapper.append(element);inputs.append(wrapper);return element;};
	const rows=input('行数',initial.rows);const columns=input('列数',initial.columns);
	const grid=doc.createElement('div');grid.className='paraflow-table-size-grid';grid.setAttribute('aria-label','选择表格大小');
	const paint=(row:number,column:number)=>{for(const button of grid.querySelectorAll<HTMLButtonElement>('button'))button.classList.toggle('is-active',Number(button.dataset.row)<=row&&Number(button.dataset.column)<=column);};
	for(let row=1;row<=8;row++)for(let column=1;column<=8;column++){
		const button=doc.createElement('button');button.type='button';button.dataset.row=String(row);button.dataset.column=String(column);button.setAttribute('aria-label',`${row} 行 × ${column} 列`);
		button.onmouseenter=()=>paint(row,column);button.onfocus=()=>paint(row,column);button.onclick=()=>{rows.value=String(row);columns.value=String(column);paint(row,column);};grid.append(button);
	}
	grid.onmouseleave=()=>paint(Number(rows.value),Number(columns.value));rows.oninput=columns.oninput=()=>paint(Number(rows.value),Number(columns.value));paint(initial.rows,initial.columns);
	const error=doc.createElement('p');error.className='paraflow-table-dialog-error';error.setAttribute('aria-live','polite');
	const buttons=doc.createElement('div');buttons.className='paraflow-table-dialog-buttons';const cancel=doc.createElement('button');cancel.type='button';cancel.textContent='取消';cancel.dataset.pfSizeCancel='';cancel.onclick=close;
	const confirm=doc.createElement('button');confirm.type='submit';confirm.textContent='确定';confirm.dataset.pfSizeApply='';buttons.append(cancel,confirm);
	root.onsubmit=event=>{event.preventDefault();const row=Number(rows.value),column=Number(columns.value);try{validateDimensions(row,column);apply(row,column);close();}catch(reason){error.textContent=reason instanceof Error?reason.message:String(reason);}};
	root.append(grid,inputs,error,buttons);doc.body.append(root);const box=root.getBoundingClientRect();root.style.left=`${Math.max(0,Math.min(point.x,doc.defaultView!.innerWidth-box.width))}px`;root.style.top=`${Math.max(0,Math.min(point.y,doc.defaultView!.innerHeight-box.height))}px`;
	doc.addEventListener('pointerdown',outside,true);doc.addEventListener('keydown',key,true);return {close,dom:root};
}
