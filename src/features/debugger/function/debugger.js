const fs = require("fs");
const createKeccakHash = require('keccak');

// TODO: use a slimmer abicoder
const { AbiCoder } = require("ethers/lib/utils");
const { hevmConfig } = require("../../../options");
const { deployContract, runInUserTerminal, writeHevmCommand, resetStateRepo, registerError, compileFromFile, checkInstallations, purgeCache } = require("../debuggerUtils");


/**Start function debugger 
 * 
 * @param {String} cwd The current working directory of selected files workspace
 * @param {String} currentFile The path to the currently selected file
 * @param {String} functionSelector The 4byte function selector of the transaction being debugged
 * @param {Array<Array<String>>} argsArray Each arg is provided in the format [type, value] so that they can easily be parsed with abi encoder
 * @param {Object} options Options - not explicitly defined 
 */
async function startDebugger(cwd, currentFile, imports, functionSelector, argsArray, options={state:true}){
  try {
    if (!(await checkInstallations())) return;

    // Create deterministic deployment address for each contract for the deployed contract
    const config = {
      ...hevmConfig,  
      hevmContractAddress: createKeccakHash("keccak256")
        .update(Buffer.from(currentFile))
        .digest("hex")
        .toString("hex")
        .slice(0,42),
      stateChecked: true
    }
    
    // Get calldata
    const calldata = await encodeCalldata(functionSelector, argsArray);
    
    // Flatten file to prevent the need to file linking -> this will be required for a wasm implementation
    const compilableFile = flattenFile(cwd, currentFile, imports);

    // Compile binary using locally installed compiler - in the future this will be replaced with a wasm compiler
    const bytecode = compileFromFile(compilableFile, config.tempMacroFilename, cwd);

    // Get runtime bytecode and run constructor logic
    const runtimeBytecode = deployContract(bytecode, config, cwd);
  
    runDebugger(runtimeBytecode, calldata,  options, config, cwd)
  }
  catch (e) {
    registerError(e, "Compilation failed, please contact the team in the huff discord");
    return null
  }
}

/**Flatten File
 * 
 * @param {String} cwd 
 * @param {String} currentFile 
 * @param {Array<String>} imports declared file imports at the top of the current file 
 * @returns 
 */
function flattenFile(cwd, currentFile, imports){
  const dirPath = currentFile.split("/").slice(0,-1).join("/")
  const paths = imports.map(importPath => `${cwd}/${dirPath}${importPath.replace(/#include\s?"./, "").replace('"', "")}`);
  paths.push(cwd+ "/" + currentFile);
  const files = paths.map(path => fs.readFileSync(path)
      .toString()
  );

  // remove include
  return `${files.join("\n")}`.replace(/#include\s".*"/gsm, "");
}


/**Run debugger
 * 
 * Craft hevm command and run it in the user terminal
 * 
 * @param {String} bytecode 
 * @param {String} calldata 
 * @param {Object} flags 
 * @param {Object} config 
 * @param {String} cwd 
 */
function runDebugger(bytecode, calldata, flags, config, cwd) {
  console.log("Entering debugger...")
  

  // Hevm Command
  const hevmCommand = `hevm exec \
  --code ${bytecode} \
  --address ${config.hevmContractAddress} \
  --caller ${config.hevmCaller} \
  --gas 0xffffffff \
  --state ${cwd + "/" + config.statePath} \
  --debug \
  ${calldata ? "--calldata " + calldata : ""}`
  
  // command is cached into a file as execSync has a limit on the command size that it can execute
  writeHevmCommand(hevmCommand, config.tempHevmCommandFilename, cwd);  
  const terminalCommand = "`cat " + cwd + "/" + config.tempHevmCommandFilename +  "`"
  runInUserTerminal(terminalCommand);
}


/**Prepare Debug Transaction
 * 
 * Use abi encoder to encode transaction data
 * 
 * @param {String} functionSelector 
 * @param {Array<Array<String>} argsObject 
 * @returns 
 */
async function encodeCalldata(functionSelector, argsObject){
    console.log("Preparing debugger calldata...")
    try {
      if (argsObject.length == 0) return `0x${functionSelector[0]}`;

      // TODO: error handle with user prompts
      const abiEncoder = new AbiCoder()
  
      // create interface readable by the abi encoder
      let type = [];
      let value = [];
      argsObject.forEach(arg => {
        type.push(arg[0]);
        value.push(arg[1]);
      });
  
      const encoded = abiEncoder.encode(type,value);
  
      return `0x${functionSelector[0]}${encoded.slice(2, encoded.length)}`
    
    } catch (e){
      registerError(e, `Compilation failed\nSee\n${e}`);
    }
}

module.exports = {
  startDebugger
}
