var map = require("./map");

module.exports.Grenade = Grenade;

/**
  * Spawns in a new grenade.
*/
function Grenade() {
	this.playerId   = 0;
	this.fuseLength = 0;
	
	this.pos        = {x: 0, y: 0, z: 0};
	this.vel        = {x: 0, y: 0, z: 0};
	
	this.timeCreated= Date.now();
	this.alive      = true;
}

Grenade.prototype.explode = function explode() {
	//TODO play sound
	//TODO particle effects
	this.alive = false;
}

Grenade.prototype.move = function move(dT) {
	var fPos = {x: this.pos.x, y: this.pos.y, z: this.pos.z};
	
	//Velocity and gravity calculation
	var f5      = dT * 32.;
	this.vel.y += dT;
	this.pos.x += this.vel.x * f5;
	this.pos.y += this.vel.y * f5;
	this.pos.z += this.vel.z * f5;
	
	//Bounce
	var lPos  = {x: Math.floor(this.pos.x), y: Math.floor(this.pos.y), z: Math.floor(this.pos.z)};
	var lPos2 = {x: Math.floor(fPos.x),     y: Math.floor(fPos.y),     z: Math.floor(fPos.z)};
	
	if(checkCollision(peer.session.map, lPos)) {
		//Collision detected!
		
		//If grenade's velocity was higher than .1, play bounce sound
		if( Math.abs(this.vel.x > .1) || Math.abs(this.vel.y) > .1 || Math.abs(this.vel.z) > .1 ) {
			//TODO play sound
		}
		
		if( lPos.y !== lPos2.y && 
		( (lPos.x === lPos2.x && lPos.z === lPos2.z) || !checkCollision(peer.session.map, {x: lPos.x, y: lPos.y, z: lPos2.z}) ))
			this.vel.y = -this.vel.y;
		else if( lPos.x !== lPos2.x && 
		( (lPos.y === lPos2.y && lPos.z === lPos2.z) || !checkCollision(peer.session.map, {x: lPos2.x, y: lPos.y, z: lPos.z}) ))
			this.vel.x = -this.vel.x;
		else if( lPos.z !== lPos2.z && 
		( (lPos.x === lPos2.x && lPos.y === lPos2.y) || !checkCollision(peer.session.map, {x: lPos.x, y: lPos2.y, z: lPos.z}) ))
			this.vel.z = -this.vel.z;
			
		this.pos.x = fPos.x;
		this.pos.y = fPos.y;
		this.pos.z = fPos.z;
		
		this.vel.x *= .36;
		this.vel.y *= .36;
		this.vel.z *= .36;
	}
}

Grenade.prototype.update = function update(dT) {
	if(Date.now() - this.timeCreated >= this.fuseLength * 1000.)
		this.explode(); //BOOM
	else
		this.move(dT);
}