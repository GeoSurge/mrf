module.exports = data => {
  try {
    return ["function", "object"].includes(typeof Buffer) && typeof Buffer.isBuffer === "function" && Buffer.isBuffer(data);
  } catch (error) {
    return false;
  }
};
