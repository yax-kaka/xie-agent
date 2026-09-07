cmake_minimum_required(VERSION 3.22.1)

project(streamnative)

# 裁剪说明：原工程在此还构建 sherpa-ncnn（STT 语音识别）与 WAMR
# （ToolPkg 的 WASM 运行时），二者对应功能已在 pi-xie 安卓版中整体移除，
# 因此这里只保留聊天流式渲染所需的 streamnative 库。

add_library(
        streamnative
        SHARED
        streamnative/native_xml_splitter.cpp
        streamnative/native_markdown_splitter.cpp
        streamnative/StreamOperators.cpp
        streamnative/plugins/StreamXmlPlugin.cpp
        streamnative/plugins/BaseJsonPlugin.cpp
        streamnative/plugins/StreamJsonPlugin.cpp
        streamnative/plugins/StreamPureJsonPlugin.cpp
        streamnative/plugins/StreamMarkdownPlugin.cpp
        streamnative/StreamBuilders.cpp
        streamnative/HotStream.cpp
        streamnative/StringExtensions.cpp
)

target_include_directories(
        streamnative
        PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}
)

find_library(
        log-lib
        log
)

target_link_libraries(
        streamnative
        ${log-lib}
)
