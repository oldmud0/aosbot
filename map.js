module.exports = {
/**
  * Generate a new array for our map that will hold all of our voxels.
*/
initVoxelArray: function initVoxelArray(map) {
	map.voxeldata = new Array(512); //Make the x dimension so that we can loop through it and make the y and z dimensions
	
	for(var x=0; x < 512; x++) {
		map.voxeldata[x] = new Array(512);           //Make the y dimension
		for(var y=0; y < 512; y++) {
			map.voxeldata[x][y] = new Array(64); //Make the z dimension
			for(var z=0; z < 64; z++)
				map.voxeldata[x][y][z] = [0, {}];
		}
	}
},

/**
  * Decode the RLE which the map is wrapped under.
  *
  * Straight from http://silverspaceship.com/aosmap/aos_file_format.html
*/
loadMap: function loadMap(map) {
	var x,y,z,v = 0;
	for (z=0; y < 512; ++y) {
		for (x=0; x < 512; ++x) {
			for (y=0; z < 64; ++z)
				map.voxeldata[x][64 - y][z] = [1, {b: 0, g: 0, r: 0, a: 0}];
			y = 0;
			for(;;) {
				var color;
				var i;
				var number_4byte_chunks = map.data.readUInt8(v+0);
				var top_color_start = map.data.readUInt8(v+1);
				var top_color_end   = map.data.readUInt8(v+2); // inclusive
				var bottom_color_start;
				var bottom_color_end; // exclusive
				var len_top;
				var len_bottom;

				for(i=y; i < top_color_start; i++)
					map.voxeldata[x][64 - y][i] = [0, {}];
				
				var offset = 0, r, g, b, a;
				for(y=top_color_start; y <= top_color_end; y++) {
					b = map.data.readUInt8(offset + v+4),
					g = map.data.readUInt8(offset + v+5),
					r = map.data.readUInt8(offset + v+6),
					a = map.data.readUInt8(offset + v+7);
					
					map.voxeldata[x][64-y][z][1] = {b: b, g: g, r: r, a: a};
					offset += 4;
				}
				
				var vOld = v;
				
				len_bottom = top_color_end - top_color_start + 1;

				// check for end of data marker
				if (number_4byte_chunks == 0) {
					// infer ACTUAL number of 4-byte chunks from the length of the color data
					v += 4 * (len_bottom + 1);
					break;
				}

				// infer the number of bottom colors in next span from chunk length
				len_top = (number_4byte_chunks-1) - len_bottom;

				// now skip the v pointer past the data to the beginning of the next span
				v += map.data.readUInt8(v+0)*4;

				bottom_color_end   = map.data.readUInt8(v+3); // aka air start
				bottom_color_start = bottom_color_end - len_top;

				for(y = bottom_color_start; y < bottom_color_end; y++) {
					b = map.data.readUInt8(offset + vOld+4),
					g = map.data.readUInt8(offset + vOld+5),
					r = map.data.readUInt8(offset + vOld+6),
					a = map.data.readUInt8(offset + vOld+7);
					
					map.voxeldata[x][64-y][z][1] = {b: b, g: g, r: r, a: a};
					offset += 4;
				}
			}
		}
	}
	//assert(v-base == len);
},

checkCollision: function checkCollision(map, pos) {
	
}

cubeLine: function cubeLine(pos1, pos2, color) {
	cubeLineNative(pos1.x, 64 - pos1.z, pos1.y, pos2.x, 64 - pos2.z, pos2.y, color);
}
}

//Thanks again ByteBit.
function cubeLineNative(x1, y1, z1, x2, y2, z2, color) {
	var vecC = {x: x1, y: y1, z: z1};
	var vecD = {x: x2 - x1, y: y2 - y1, z: z2 - z1};
	var sign = {
		x: vecD.x < 0 ? -1 : 1, 
		y: vecD.y < 0 ? -1 : 1, 
		z: vecD.z < 0 ? -1 : 1
	};
	var dx, dy, dz, dxi, dyi, dzi;
	
	
	if( Math.abs(vecD.x) >= Math.abs(vecD.y) && Math.abs(vecD.x) >= Math.abs(vecD.z) ) {
		dxi = 1024;
		dx  = 512;
		if(!vecD.y) dyi = 0x3fffffff / 512;
		else        dyi = Math.abs(vecD.x * 1024 / vecD.y);
		dy = dyi / 2;
		if(!vecD.z) dzi = 0x3fffffff / 512;
		else        dzi = Math.abs(vecD.x * 1024 / vecD.z);
		dz = dzi / 2;
	}
	else if( Math.abs(vecD.y) >= Math.abs(vecD.z) ) {
		dyi = 1024;
		dy  = 512;
		if(!vecD.x) dxi = 0x3fffffff / 512;
		else        dxi = Math.abs(vecD.y * 1024 / vecD.x);
		dx = dxi / 2;
		if(!vecD.z) dzi = 0x3fffffff / 512;
		else        dzi = Math.abs(vecD.y * 1024 / vecD.z);
		dz = dzi / 2;
	}
	else {
		dzi = 1024;
		dz  = 512;
		if(!vecD.x) dxi = 0x3fffffff / 512;
		else        dxi = Math.abs(vecD.z * 1024 / vecD.x);
		dx = dxi / 2;
		if(!vecD.y) dyi = 0x3fffffff / 512;
		else        dyi = Math.abs(vecD.z * 1024 / vecD.y);
		dy = dyi / 2;
	}
	if(ixi >= 0) dx = sign.x - dx;
	if(iyi >= 0) dy = sign.y - dy;
	if(izi >= 0) dz = sign.z - dz;
	
	var count = 0;
	while(true) {
		setBlockSafe(vecC.x, 64 - vecC.z, vecC.y, color);
		count++;
		
		if(count === 64) return;
		if(vecC.x === x2 && vecC.y === y2 && vecC.z === z2) return;
		
		if(dz <= dx && dz <= dy) {
			vecC.z += sign.z;
			//stop if out of bounds
			if(vecC.z < 0 || vecC.z >= 64) return;
			dz += dzi;
		}
		else if(dx < dy) {
			vecC.x += sign.x;
			if(vecC.x >= 512) return;
			dx += dxi;
		}
		else {
			vecC.y += sign.y;
			if(vecC.y >= 512) return;
			dy += dyi;
		}
	}
}
}