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
				map.voxeldata[x][y][z] = 0;
		}
	}
},

/**
  * Decode the RLE which the map is wrapped under.
  *
  * Straight from http://silverspaceship.com/aosmap/aos_file_format.html
  * We don't want color. All color-related code snippets have been commented out for possible future use.
*/
loadMap: function loadMap(map) {
	var x,y,z,v = 0;
	for (y=0; y < 512; ++y) {
		for (x=0; x < 512; ++x) {
			for (z=0; z < 64; ++z) {
				map.voxeldata[x][y][z] = 1;
				
				//cursor.horizontalAbsolute(0).write("Decoding RLE from map... ("+x+","+y+","+z+")");
			}
			z = 0;
			for(;;) {
				//var color;
				var i;
				var number_4byte_chunks = map.data.readUInt8(v+0);
				var top_color_start = map.data.readUInt8(v+1);
				var top_color_end   = map.data.readUInt8(v+2); // inclusive
				var bottom_color_start;
				var bottom_color_end; // exclusive
				var len_top;
				var len_bottom;

				for(i=z; i < top_color_start; i++)
					map.voxeldata[x][y][i] = 0;

				//color = (uint32 *) (v+4);
				//for(z=top_color_start; z <= top_color_end; z++)
				//setcolor(x,y,z,*color++);

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

				//for(z=bottom_color_start; z < bottom_color_end; ++z) {
				//	setcolor(x,y,z,*color++);
				//}
				
				z = bottom_color_end;
				
				//cursor.horizontalAbsolute(0).write("Decoding RLE from map... ("+x+","+y+","+z+")");
			}
		}
	}
	//assert(v-base == len);
}
}