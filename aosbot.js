var enet 	= require('enet');
var buf2hex 	= require("hex");
var colors 	= require("colors");
var ansi	= require("ansi")
   ,cursor	= ansi(process.stdout);
var zlib	= require("zlib");

var id = 16777343;
var port = 51253;

var client, peer, serverAddr;

//Initialize client
function initClient() {
	client = new enet.Host(new enet.Address('localhost', 0), 128, 1, 256000, 256000, "client");
	client.start(17);
	console.log("ENet client initialized.");
}

//Connect to server
function connect(id, port) {
	//Convert our URL to an IP address
	var serverIP = [ id & 0xFF, (id >> 8) & 0xFF, (id >> 16) & 0xFF, (id >> 24) & 0xFF ].join('.');
	serverAddr = new enet.Address(serverIP, port);
	serverAddr.hostToString = function(){return [ serverAddr._host & 0xFF, (serverAddr._host >> 8) & 0xFF, (serverAddr._host >> 16) & 0xFF, (serverAddr._host >> 24) & 0xFF ].join('.');}
	console.log("Got server address.");
	
	//Establish connection to our server
	console.log("Connecting to server " + serverAddr.hostToString() + ":" + serverAddr.port() + "...");
	peer = client.connect(
		serverAddr,
		1, //Channels we're going to use (AoS does not work in surround)
		3, //Data
		function(err) {
			if(err) {
				console.log(err);
				return;
			}
		}
	);
}

initClient();
connect(id, port);

peer.on("connect", function() {
	//Connection success
	console.log("Connection established to " + serverAddr.hostToString() + " through port " + serverAddr.port());
	peer.ping();
	
	peer.session = {};
});

//18 (client joins)
//19 (mapdata)
//15 (end mapdata?)
//17 (chat msg)
//2 (constant feed of all player positions)

peer.on("message", function(packet, channel) {
	packetID = packet.data().readUInt8(0);
	
	//Event based package handling (terrible)
	switch(packetID) {
		case 18: //Client join
			console.log("--- Map start ---".bold.yellow.cyanBG);
			peer.session.map = {};
			peer.session.map.currentlyGrabbing = true;
			
			//buf2hex(packet.data());
			
			//break;
			peer.session.map.size = packet.data().readUInt32LE(1);
			console.log("Map size: " + peer.session.map.size + " bytes.");
			
			peer.session.map.dataRaw = new Buffer(peer.session.map.size);
			peer.session.map.progress = 0;
			break;
		case 19: //Map data packet
			//Copy packet data (except the packet ID) to the map data
			packet.data().copy(peer.session.map.dataRaw, peer.session.map.progress, 1);
			
			//Add packet's length to the progress
			peer.session.map.progress += packet.data().length-1;
			
			//Show our current progress
			process.stdout.write(peer.session.map.progress + "/" + peer.session.map.size);
			cursor.horizontalAbsolute(0);
			break;
		case 15: //Gamemode data
			//For now we'll also use it as a way to tell us when to stop downloading the map.
			peer.session.map.currentlyGrabbing = false;
			console.log("Done downloading map. Got " + peer.session.map.progress + " bytes.");
			
			///////////////////////////////
			//Let's decompress this map! :D
			///////////////////////////////
			console.log("Decompressing map...")
			var err = zlib.inflate(peer.session.map.dataRaw, function(err, result) {
				cursor.horizontalAbsolute(0);
				
				//If we got an error, print it out
				if(err) {
					console.log( ("DECOMPRESSION ERROR: " + err).bold.yellow.redBG );
					return err;
				}
				
				//Else, tell the user that decompression's done and assign the result to map data
				console.log("Decompression completed. Map size: " + result.length + " bytes.");
				peer.session.map.data = result;
			});
			
			//We don't need dataRaw anymore. Delete it.
			delete peer.session.map.dataRaw;
			
			//Stop here if we've gotten an error
			if(err) {
				console.log("We got an error. Stop map extraction.".bold.redBG);
				break;
			}
			
			////////////
			//Decode RLE
			////////////
			
			//But first, let's take a moment to create a 3D array that will hold our voxels.
			//Basically, all we need to know if a voxel is an open voxel (false) or a solid voxel (true).
			peer.session.map.voxeldata = [];
			peer.session.map.voxeldata[0] = [];
			peer.session.map.voxeldata[0][0] = [];
			
			var loadMap = function() {
				var x,y,z,v = 0;
				for (y=0; y < 512; ++y) {
					for (x=0; x < 512; ++x) {
						for (z=0; z < 64; ++z) {
							peer.session.map.voxeldata[x][y][z] = 1;
						}
						z = 0;
						for(;;) {
							//var color;
							var number_4byte_chunks = peer.session.map.data.readUInt8(v+0);
							var top_color_start = peer.session.map.data.readUInt8(v+1);
							var top_color_end   = peer.session.map.data.readUInt8(v+2); // inclusive
							var bottom_color_start;
							var bottom_color_end; // exclusive
							var len_top;
							var len_bottom;

							for(var i=z; i < top_color_start; i++)
								peer.session.map.voxeldata[x][y][i] = 0;

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
							v += peer.session.map.data.readUInt8(v+0)*4;

							bottom_color_end   = peer.session.map.data.readUInt8(v+3); // aka air start
							bottom_color_start = bottom_color_end - len_top;

							//for(z=bottom_color_start; z < bottom_color_end; ++z) {
							//	setcolor(x,y,z,*color++);
							//}
							
							z = bottom_color_end;
						}
					}
				}
				assert(v-base == len);
			}
			
			
			break;
	}
});

peer.on("disconnect", function() {
	//Disconnected
	console.log("dang it");
	client.stop();
});
