import type {TableActionTarget} from './action-target';
import type {TableAxis} from './model';
import {moveTracks} from './reordering';
import {moveMarkdownTracks} from './toolbar-source';

/** Reordering follows the selected content, including its cell caret and range. */
export function moveTableTracks(target:TableActionTarget,axis:TableAxis,direction:-1|1):void {
 const bounds=target.trackRectangle,session=target.session,table=session.table;
 const row=axis==='row',first=row?bounds.top:bounds.left,last=row?bounds.bottom:bounds.right,count=row?table.rows:table.columns;
 if(direction<0&&first===0||direction>0&&last===count-1)return;
 const change=row?{kind:'move' as const,first,last,direction}:undefined;
 const source=session.target.kind==='markdown'?moveMarkdownTracks(session.target.source,axis,first,last,first+direction):session.serialize(moveTracks(table,axis,first,last,direction),true,change);
 const before=target.focusBookmark,rectangle=before.rectangle;
 const focus={...before,cell:{...before.cell,[axis]:before.cell[axis]+direction},rectangle:rectangle?{...rectangle,...(row?{top:rectangle.top+direction,bottom:rectangle.bottom+direction}:{left:rectangle.left+direction,right:rectangle.right+direction})}:undefined};
 target.replaceSource(source,change,focus);
}
