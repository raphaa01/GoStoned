// Only the command boundary is stubbed: the production stream buffers below
// are compiled unchanged by katago-stream.test.cpp.
#pragma once
#include <string>
#include <vector>
namespace Version {
inline std::string getKataGoVersion() { return "test"; }
}
namespace MainCmds {
inline int analysis(const std::vector<std::string>&) { return 0; }
}
