/** Native table menus may display in a later task. Bind only the original event. */
export function createNativeMenuBridge<Menu,EventType extends object>(prototype:{showAtMouseEvent:(event:EventType)=>Menu},augment:(menu:Menu,event:EventType)=>void):{arm:(event:EventType)=>void;destroy:()=>void} {
	const original=prototype.showAtMouseEvent;const captured=new WeakSet<EventType>();let destroyed=false;
	function show(this:Menu,event:EventType):Menu {
		if(!destroyed&&captured.has(event)){captured.delete(event);augment(this,event);}
		return original.call(this,event);
	}
	prototype.showAtMouseEvent=show;
	return {arm(event){if(!destroyed)captured.add(event);},destroy(){destroyed=true;if(prototype.showAtMouseEvent===show)prototype.showAtMouseEvent=original;}};
}
